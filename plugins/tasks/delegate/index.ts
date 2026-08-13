import type { BbPluginApi, PluginRpcHandlers } from "@bb/plugin-sdk";
import { z } from "zod";
import type {
  Attachment,
  Comment,
  Preset,
  Project,
  Task,
  TasksStore,
  TaskThreadLiveStatus,
} from "../db";
import { publishProjectsChanged, type TasksApiStore } from "../api";
import {
  presetPermissionModeSchema,
  type CommentsChangedEvent,
  type TasksChangedEvent,
  type ThreadsChangedEvent,
} from "../shared/contract";
import { delegationRpcContract } from "./contract";

const MAX_DELEGATED_THREAD_TITLE_LENGTH = 120;
const SYSTEM_AUTHOR_NAME = "Tasks";
const MANUAL_PRESET_NAME = "Attached";
const WORKSPACE_AGENT_COLORS = ["blue", "purple", "green", "orange"];

const presetExecutionSchema = z
  .object({
    providerId: z.string().trim().min(1),
    model: z.string().trim().min(1),
    reasoningLevel: z.enum([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
      "ultra",
    ]),
    permissionMode: presetPermissionModeSchema,
  })
  .strict();

export type DelegationErrorCode = "project_not_linked" | "spawn_target_invalid";

export class DelegationError extends Error {
  constructor(
    readonly code: DelegationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DelegationError";
  }
}

export interface SeedPromptInput {
  task: Task;
  project: Project;
  subtasks: readonly Task[];
  attachments: readonly Pick<Attachment, "id" | "fileName">[];
  recentComments: readonly Comment[];
  presetInstructions: string;
  extraInstructions?: string;
}

function markdownSection(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

function formatSubtasks(subtasks: readonly Task[]): string {
  if (subtasks.length === 0) return "None.";
  return subtasks
    .map((subtask) => `- ${subtask.key} · ${subtask.title} (${subtask.status})`)
    .join("\n");
}

function formatAttachments(
  attachments: readonly Pick<Attachment, "id" | "fileName">[],
): string {
  if (attachments.length === 0) return "None.";
  return attachments
    .map(
      (attachment) =>
        `- ${attachment.fileName} · ${attachment.id}\n` +
        `  Fetch with: bb tasks attachment get ${attachment.id} --out <path>`,
    )
    .join("\n");
}

function formatComments(comments: readonly Comment[]): string {
  if (comments.length === 0) return "None.";
  return comments
    .map(
      (comment) =>
        `### ${comment.authorName} · ${comment.kind} · ${comment.createdAt}\n\n${comment.body}`,
    )
    .join("\n\n");
}

export function buildSeedPrompt(input: SeedPromptInput): string {
  const sections = [
    `# ${input.task.key} · ${input.task.title}`,
    markdownSection(
      "Description",
      input.task.description.trim() || "No description provided.",
    ),
    markdownSection(
      "Project context",
      `- Name: ${input.project.name}\n- Linked bb project: ${input.project.linkedBbProjectId ?? "Not linked"}`,
    ),
    markdownSection("Sub-tasks", formatSubtasks(input.subtasks)),
    markdownSection("Attachments", formatAttachments(input.attachments)),
    markdownSection("Recent comments", formatComments(input.recentComments)),
    markdownSection(
      "Report-back contract",
      `You are working on task ${input.task.key}. Use the bb tasks CLI: comment substantive updates (bb tasks comment ${input.task.key} --body ...), attach result artifacts, set status when done (bb tasks update ${input.task.key} --status in_review) or explain blockage in a comment. Your thread is already attached to the task.`,
    ),
  ];

  if (input.presetInstructions.trim()) {
    sections.push(
      markdownSection("Preset instructions", input.presetInstructions.trim()),
    );
  }
  if (input.extraInstructions?.trim()) {
    sections.push(
      markdownSection(
        "Additional instructions",
        input.extraInstructions.trim(),
      ),
    );
  }

  return `${sections.join("\n\n")}\n`;
}

function delegatedThreadTitle(task: Task): string {
  return `${task.key} · ${task.title}`.slice(
    0,
    MAX_DELEGATED_THREAD_TITLE_LENGTH,
  );
}

function workspaceAgentDisplayName(
  role: "builder" | "reviewer",
): "Builder" | "Agent 2" {
  return role === "builder" ? "Builder" : "Agent 2";
}

function workspaceAgentTitle(
  role: "builder" | "reviewer",
  input: readonly { type: string; text?: string }[],
): string {
  const firstText = input.find(
    (entry): entry is { type: "text"; text: string } =>
      entry.type === "text" &&
      typeof entry.text === "string" &&
      entry.text.trim().length > 0,
  );
  const fallback = `${workspaceAgentDisplayName(role)} workspace task`;
  return (firstText?.text.trim() ?? fallback)
    .replace(/\s+/gu, " ")
    .slice(0, 120);
}

function workspaceAgentDescription(
  input: readonly { type: string; text?: string }[],
): string {
  return input
    .filter(
      (entry): entry is { type: "text"; text: string } =>
        entry.type === "text" && typeof entry.text === "string",
    )
    .map((entry) => entry.text)
    .join("\n\n");
}

function workspaceAgentPrefix(
  projectName: string,
  projects: readonly Project[],
): string {
  let base = projectName
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, 10);
  if (!base || !/^[A-Z]/u.test(base)) base = `P${base}`;
  const used = new Set(projects.map((project) => project.prefix));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = String(suffix);
    const candidate = `${base.slice(0, 10 - suffixText.length)}${suffixText}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not derive a unique Tasks prefix for ${projectName}`);
}

function workspaceAgentPrompt(
  task: Task,
  role: "builder" | "reviewer",
): string {
  const roleInstruction =
    role === "builder"
      ? `You are the build agent for ${task.key}.`
      : `You are the second workspace agent for ${task.key}. Follow the user's requested role; do not assume this is a review task.`;
  return [
    `# ${task.key} · ${task.title}`,
    "## Task",
    task.description.trim() || "No text prompt was supplied.",
    "## User-facing behavior",
    "Respond directly to the user's request. Do not mention or narrate this task record, its key, the Tasks workflow, bb tasks CLI commands, status changes, or other bookkeeping in user-visible messages. Keep bookkeeping in tool calls. For a casual or conversational prompt with no work requested, reply conversationally and do not inspect task files or run task commands.",
    "## Report-back contract",
    `${roleInstruction} Post meaningful progress milestones with \`bb tasks comment ${task.key} --body ...\`. When the work is ready for human review, run \`bb tasks update ${task.key} --status in_review\`. Do not mark the task Done automatically; explain any blockage in a task comment.`,
  ].join("\n\n");
}

function requireTask(store: TasksStore, taskId: string): Task {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function requireProject(store: TasksStore, projectId: string): Project {
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

function requirePreset(store: TasksStore, presetId: string): Preset {
  const preset = store.getPreset(presetId);
  if (!preset) throw new Error(`Preset not found: ${presetId}`);
  return preset;
}

function requireLinkedBbProject(project: Project): string {
  if (project.linkedBbProjectId) return project.linkedBbProjectId;
  throw new DelegationError(
    "project_not_linked",
    `Task project "${project.name}" is not linked to a bb project`,
  );
}

function collectAttachments(
  store: TasksStore,
  taskId: string,
  comments: readonly Comment[],
): Attachment[] {
  const attachments = new Map<string, Attachment>();
  for (const attachment of store.listAttachmentsForTask(taskId)) {
    attachments.set(attachment.id, attachment);
  }
  for (const comment of comments) {
    for (const attachment of store.listAttachmentsForComment(comment.id)) {
      attachments.set(attachment.id, attachment);
    }
  }
  return [...attachments.values()];
}

type SpawnEnvironment = Parameters<
  BbPluginApi["sdk"]["threads"]["spawn"]
>[0]["environment"];

async function presetSpawnEnvironment(
  bb: BbPluginApi,
  preset: Preset,
): Promise<SpawnEnvironment> {
  if (preset.environmentKind === "project-default") {
    return { type: "project-default" };
  }

  const hostId =
    preset.machineId ?? (await bb.sdk.system.config()).primaryHostId;
  if (hostId === null) {
    throw new DelegationError(
      "spawn_target_invalid",
      "Could not create a worktree because BB has no default machine",
    );
  }
  return {
    type: "host",
    hostId,
    workspace: {
      type: "managed-worktree",
      baseBranch:
        preset.baseBranch === null
          ? { kind: "default" }
          : { kind: "named", name: preset.baseBranch },
    },
  };
}

function isBbHttpError(
  error: unknown,
): error is Error & { code: string | null; status: number } {
  return (
    error instanceof Error &&
    "code" in error &&
    (typeof error.code === "string" || error.code === null) &&
    "status" in error &&
    typeof error.status === "number"
  );
}

const SPAWN_TARGET_ERROR_CODES = new Set([
  "host_not_found",
  "host_unavailable",
  "invalid_request",
  "project_unavailable",
  "unsupported_host",
  "workspace_unavailable",
]);

function mapSpawnTargetError(error: unknown, preset: Preset): never {
  if (
    preset.environmentKind === "new-worktree" &&
    isBbHttpError(error) &&
    error.code !== null &&
    SPAWN_TARGET_ERROR_CODES.has(error.code)
  ) {
    const machine = preset.machineId ?? "the default machine";
    const branch = preset.baseBranch ?? "the default branch";
    const detail = error.message.replace(/^HTTP \d+:\s*/u, "");
    throw new DelegationError(
      "spawn_target_invalid",
      `Could not create a worktree on ${machine} from ${branch}: ${detail}`,
    );
  }
  throw error;
}

export function createSystemComment(
  store: TasksStore,
  input: {
    taskId: string;
    presetName: string;
    threadId: string;
    body: string;
  },
): void {
  store.createComment({
    taskId: input.taskId,
    kind: "system",
    authorName: SYSTEM_AUTHOR_NAME,
    presetName: input.presetName,
    threadId: input.threadId,
    body: input.body,
    notifiedCount: 0,
  });
}

export function publishThreadsChanged(bb: BbPluginApi, taskId: string): void {
  const payload: ThreadsChangedEvent = { taskId };
  bb.realtime.publish("threads:changed", payload);
}

function publishTasksChanged(
  bb: BbPluginApi,
  taskId: string,
  projectId: string,
): void {
  const payload: TasksChangedEvent = { taskId, projectId };
  bb.realtime.publish("tasks:changed", payload);
}

export function publishCommentsChanged(bb: BbPluginApi, taskId: string): void {
  const payload: CommentsChangedEvent = { taskId };
  bb.realtime.publish("comments:changed", payload);
}

type SdkThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

function taskThreadLiveStatus(thread: SdkThread): TaskThreadLiveStatus {
  if (thread.deletedAt != null) return "completed";
  switch (thread.status) {
    case "starting":
      return "starting";
    case "active":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
    case "error":
      return "failed";
  }
}

export function handlers(
  bb: BbPluginApi,
  store: TasksApiStore,
): PluginRpcHandlers<typeof delegationRpcContract> {
  return {
    async delegate(input) {
      const task = requireTask(store.tasks, input.taskId);
      const project = requireProject(store.tasks, task.projectId);
      const linkedBbProjectId = requireLinkedBbProject(project);
      const preset = requirePreset(store.tasks, input.presetId);
      const comments = store.tasks.listComments(task.id);
      const recentComments = comments.slice(-5);
      const title = delegatedThreadTitle(task);
      const execution = presetExecutionSchema.parse({
        providerId: preset.providerId,
        model: preset.modelId,
        reasoningLevel: preset.reasoningLevel,
        permissionMode: preset.permissionMode,
      });
      const prompt = buildSeedPrompt({
        task,
        project,
        subtasks: store.tasks.listSubtasks(task.id),
        attachments: collectAttachments(store.tasks, task.id, comments),
        recentComments,
        presetInstructions: preset.instructions,
        extraInstructions: input.extraInstructions,
      });

      const environment = await presetSpawnEnvironment(bb, preset);
      const thread = await bb.sdk.threads
        .spawn({
          projectId: linkedBbProjectId,
          environment,
          providerId: execution.providerId,
          model: execution.model,
          reasoningLevel: execution.reasoningLevel,
          permissionMode: execution.permissionMode,
          title,
          prompt,
        })
        .catch((error: unknown) => mapSpawnTargetError(error, preset));

      const taskThread = store.transaction(() => {
        const attached = store.tasks.upsertTaskThread({
          taskId: task.id,
          threadId: thread.id,
          presetName: preset.name,
          title,
          liveStatus: "starting",
        });

        if (task.status === "backlog" || task.status === "todo") {
          store.tasks.updateTask(task.id, { status: "in_progress" });
          createSystemComment(store.tasks, {
            taskId: task.id,
            presetName: preset.name,
            threadId: thread.id,
            body: `Status changed to In Progress · dispatched to ${preset.name}`,
          });
        }

        createSystemComment(store.tasks, {
          taskId: task.id,
          presetName: preset.name,
          threadId: thread.id,
          body: `Dispatched to ${preset.name}`,
        });
        return attached;
      });

      try {
        const currentThread = await bb.sdk.threads.get({ threadId: thread.id });
        const currentLiveStatus = taskThreadLiveStatus(currentThread);
        if (currentLiveStatus !== taskThread.liveStatus) {
          store.tasks.updateTaskThreadStatus(taskThread.id, currentLiveStatus);
        }
      } catch (error) {
        bb.log.warn(
          `Could not read delegated thread ${thread.id} after attach: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      publishThreadsChanged(bb, task.id);
      publishTasksChanged(bb, task.id, task.projectId);
      publishCommentsChanged(bb, task.id);
      return { threadId: thread.id };
    },

    async workspaceAgentStart(input) {
      const existingForKey = store.tasks.getWorkspaceAgentStartByWorkspaceKey(
        input.workspaceKey,
      );
      if (existingForKey && existingForKey.bbProjectId !== input.bbProjectId) {
        throw new DelegationError(
          "spawn_target_invalid",
          "This workspace agent key is already assigned to a different BB project",
        );
      }
      if (existingForKey?.threadId) {
        const task = requireTask(store.tasks, existingForKey.taskId);
        return {
          taskId: task.id,
          taskKey: task.key,
          threadId: existingForKey.threadId,
          environmentId: existingForKey.environmentId,
        };
      }
      if (existingForKey) {
        throw new DelegationError(
          "spawn_target_invalid",
          "This workspace agent is already starting; retry after the first start completes",
        );
      }

      const linkedProjects = store.tasks
        .listProjects()
        .filter((project) => project.linkedBbProjectId === input.bbProjectId);
      if (linkedProjects.length > 1) {
        throw new DelegationError(
          "project_not_linked",
          `Multiple Tasks projects are linked to ${input.bbProjectId}; resolve the duplicate link before starting an agent`,
        );
      }
      const createdProject = linkedProjects[0] === undefined;
      const project =
        linkedProjects[0] ??
        store.tasks.createProject({
          name: input.projectName,
          prefix: workspaceAgentPrefix(
            input.projectName,
            store.tasks.listProjects(),
          ),
          color:
            WORKSPACE_AGENT_COLORS[
              store.tasks.listProjects().length % WORKSPACE_AGENT_COLORS.length
            ] ?? "blue",
          linkedBbProjectId: input.bbProjectId,
        });
      const title = workspaceAgentTitle(input.role, input.request.input);
      const description = workspaceAgentDescription(input.request.input);
      const task = store.transaction(() => {
        const created = store.tasks.createTask({
          projectId: project.id,
          title,
          description,
          status: "in_progress",
        });
        store.tasks.createWorkspaceAgentStart({
          bbProjectId: input.bbProjectId,
          workspaceKey: input.workspaceKey,
          taskId: created.id,
        });
        return created;
      });

      let thread: Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["spawn"]>>;
      try {
        thread = await bb.sdk.threads.spawn({
          projectId: input.bbProjectId,
          providerId: input.request.providerId,
          model: input.request.model,
          reasoningLevel: input.request.reasoningLevel,
          permissionMode: input.request.permissionMode,
          ...(input.request.serviceTier === undefined
            ? {}
            : { serviceTier: input.request.serviceTier }),
          executionInputSources: input.request.executionInputSources,
          environment: input.request.environment,
          title: `${task.key} · ${task.title}`.slice(
            0,
            MAX_DELEGATED_THREAD_TITLE_LENGTH,
          ),
          input: [
            ...input.request.input,
            {
              type: "text" as const,
              text: workspaceAgentPrompt(task, input.role),
              mentions: [],
              visibility: "agent-only" as const,
            },
          ],
        });
      } catch (error) {
        store.transaction(() => {
          store.tasks.deleteWorkspaceAgentStart(
            input.bbProjectId,
            input.workspaceKey,
          );
          store.tasks.deleteTask(task.id);
          if (
            createdProject &&
            store.tasks.listTasks({ projectId: project.id }).length === 0 &&
            store.tasks.listLabels(project.id).length === 0
          ) {
            store.tasks.deleteProject(project.id);
          }
        });
        throw error;
      }
      const environmentId = thread.environmentId;
      store.transaction(() => {
        store.tasks.upsertTaskThread({
          taskId: task.id,
          threadId: thread.id,
          presetName: workspaceAgentDisplayName(input.role),
          title: `${task.key} · ${task.title}`.slice(
            0,
            MAX_DELEGATED_THREAD_TITLE_LENGTH,
          ),
          liveStatus: "starting",
        });
        store.tasks.completeWorkspaceAgentStart({
          bbProjectId: input.bbProjectId,
          workspaceKey: input.workspaceKey,
          threadId: thread.id,
          environmentId,
        });
        createSystemComment(store.tasks, {
          taskId: task.id,
          presetName: workspaceAgentDisplayName(input.role),
          threadId: thread.id,
          body: `Status changed to In Progress · ${workspaceAgentDisplayName(input.role)} workspace agent dispatched`,
        });
        createSystemComment(store.tasks, {
          taskId: task.id,
          presetName: workspaceAgentDisplayName(input.role),
          threadId: thread.id,
          body: `${workspaceAgentDisplayName(input.role)} workspace agent attached`,
        });
      });
      publishProjectsChanged(bb, project.id);
      publishThreadsChanged(bb, task.id);
      publishTasksChanged(bb, task.id, project.id);
      publishCommentsChanged(bb, task.id);
      return {
        taskId: task.id,
        taskKey: task.key,
        threadId: thread.id,
        environmentId,
      };
    },

    async taskThreadsAttach(input) {
      const task = requireTask(store.tasks, input.taskId);
      const thread = await bb.sdk.threads.get({ threadId: input.threadId });
      const title = (
        thread.title ??
        thread.titleFallback ??
        delegatedThreadTitle(task)
      ).slice(0, MAX_DELEGATED_THREAD_TITLE_LENGTH);

      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId: thread.id,
        presetName: MANUAL_PRESET_NAME,
        title,
        liveStatus: taskThreadLiveStatus(thread),
      });

      publishThreadsChanged(bb, task.id);
      publishTasksChanged(bb, task.id, task.projectId);
      return { threadId: thread.id };
    },
  };
}

export function registerDelegation(
  bb: BbPluginApi,
  store: TasksApiStore,
): void {
  bb.rpc.register(delegationRpcContract, handlers(bb, store));
}
