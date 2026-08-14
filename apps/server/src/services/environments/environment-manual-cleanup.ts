import {
  getEnvironment,
  listLiveThreadsInEnvironment,
  listProjectSources,
  setEnvironmentCleanupMode,
} from "@bb/db";
import type {
  EnvironmentCleanupAction,
  EnvironmentCleanupPreflight,
  EnvironmentCleanupRequest,
  EnvironmentCleanupResponse,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  archiveEnvironmentThreads,
  archiveThreadAndHiddenSourceForks,
} from "../threads/thread-archive.js";
import { requireThreadHostCommandEnvironment } from "../threads/thread-command-environment.js";
import { callEnvironmentWorkspaceStatus } from "./workspace-status.js";
import { requireWorkspaceCommandTarget } from "./workspace-command-target.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
} from "./environment-cleanup-internal.js";

function sameFolder(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalize(left) === normalize(right);
}

function isActiveStatus(status: string): boolean {
  return status === "starting" || status === "active" || status === "stopping";
}

export async function buildEnvironmentCleanupPreflight(
  deps: AppDeps,
  environmentId: string,
): Promise<EnvironmentCleanupPreflight> {
  const environment = getEnvironment(deps.db, environmentId);
  if (!environment) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  const liveThreads = listLiveThreadsInEnvironment(deps.db, {
    environmentId,
  }).map((thread) => ({
    id: thread.id,
    title: thread.title,
    status: thread.status,
  }));
  const environmentPath = environment.path;
  const protectedCanonicalFolder =
    environmentPath !== null &&
    listProjectSources(deps.db, environment.projectId).some(
      (source) =>
        source.hostId === environment.hostId &&
        sameFolder(source.path, environmentPath),
    );

  let workspace: EnvironmentCleanupPreflight["workspace"] = null;
  let workspaceUnavailableReason: string | null = null;
  if (
    !protectedCanonicalFolder &&
    environment.managed &&
    environment.workspaceProvisionType === "managed-worktree" &&
    environment.status !== "destroyed" &&
    environment.path !== null &&
    environment.isGitRepo
  ) {
    const result = await callEnvironmentWorkspaceStatus(deps, {
      environment,
      target: requireWorkspaceCommandTarget(environment),
      ...((environment.mergeBaseBranch ??
      environment.baseBranch ??
      environment.defaultBranch)
        ? {
            mergeBaseBranch:
              environment.mergeBaseBranch ??
              environment.baseBranch ??
              environment.defaultBranch ??
              undefined,
          }
        : {}),
    });
    if (result.outcome === "available") workspace = result.workspaceStatus;
    else workspaceUnavailableReason = result.failure.message;
  }

  const allowedActions: EnvironmentCleanupAction[] = [];
  if (liveThreads.length > 0) allowedActions.push("detach_thread");
  const baseRemovable =
    environment.managed &&
    environment.workspaceProvisionType === "managed-worktree" &&
    environment.isWorktree &&
    environment.status === "ready" &&
    !protectedCanonicalFolder &&
    workspace !== null &&
    workspace.mergeBase !== null;
  const hasActiveThread = liveThreads.some((thread) =>
    isActiveStatus(thread.status),
  );
  let recommendedAction: EnvironmentCleanupAction | null = null;
  let summary: string;

  if (protectedCanonicalFolder) {
    summary =
      "Protected project folder. It can never be removed as a managed working copy.";
  } else if (
    !environment.managed ||
    environment.workspaceProvisionType !== "managed-worktree"
  ) {
    summary = "This is not a removable managed working copy.";
  } else if (environment.status !== "ready") {
    summary = `Working copy is ${environment.status} and cannot start another cleanup action.`;
  } else if (workspace === null) {
    summary = workspaceUnavailableReason ?? "Git preflight is unavailable.";
  } else if (hasActiveThread) {
    allowedActions.push("discard");
    recommendedAction = "detach_thread";
    summary =
      "An agent is active. Detach this task, or explicitly abandon it before removing the shared folder.";
  } else if (workspace.workingTree.hasUncommittedChanges) {
    allowedActions.push("discard");
    recommendedAction = "discard";
    summary =
      "Tracked or untracked changes would be lost. Removal requires destructive confirmation.";
  } else if (workspace.mergeBase?.hasCommittedUnmergedChanges) {
    allowedActions.push("keep_branch", "discard");
    recommendedAction = "keep_branch";
    summary =
      "Committed work is not merged. The folder can be removed while preserving its branch.";
  } else if (baseRemovable) {
    allowedActions.push("safe_delete");
    recommendedAction = "safe_delete";
    summary =
      "Clean, merged, and inactive. Safe one-click cleanup is available.";
  } else {
    summary = "This working copy is not currently removable.";
  }

  return {
    environment: {
      id: environment.id,
      name: environment.name,
      branchName: environment.branchName,
      path: environment.path,
      status: environment.status,
      updatedAt: environment.updatedAt,
    },
    protectedCanonicalFolder,
    liveThreads,
    workspace,
    workspaceUnavailableReason,
    allowedActions,
    recommendedAction,
    summary,
  };
}

export async function runEnvironmentCleanupAction(
  deps: AppDeps,
  environmentId: string,
  request: EnvironmentCleanupRequest,
): Promise<EnvironmentCleanupResponse> {
  const preflight = await buildEnvironmentCleanupPreflight(deps, environmentId);
  if (!preflight.allowedActions.includes(request.action)) {
    throw new ApiError(409, "cleanup_blocked", preflight.summary);
  }

  if (request.action === "detach_thread") {
    if (!request.threadId) {
      throw new ApiError(409, "thread_required", "Choose the task to detach");
    }
    const thread = listLiveThreadsInEnvironment(deps.db, {
      environmentId,
    }).find((candidate) => candidate.id === request.threadId);
    if (!thread) {
      throw new ApiError(
        409,
        "thread_not_attached",
        "Task is not attached to this working copy",
      );
    }
    const environment = requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    const archived = archiveThreadAndHiddenSourceForks(deps, {
      environment,
      thread,
    });
    return {
      ok: true,
      action: request.action,
      archivedThreadIds: archived ? [archived.id] : [],
    };
  }

  const otherActiveThread = preflight.liveThreads.find(
    (thread) => thread.id !== request.threadId && isActiveStatus(thread.status),
  );
  if (otherActiveThread) {
    throw new ApiError(
      409,
      "working_copy_in_use",
      `Cannot remove this shared working copy while ${otherActiveThread.title ?? otherActiveThread.id} is active`,
    );
  }
  if (request.action === "discard" && request.confirmation !== environmentId) {
    throw new ApiError(
      409,
      "confirmation_required",
      `Type ${environmentId} to confirm discarding valuable changes`,
    );
  }

  setEnvironmentCleanupMode(deps.db, deps.hub, environmentId, request.action);
  const environment = getEnvironment(deps.db, environmentId);
  if (!environment)
    throw new ApiError(404, "environment_not_found", "Environment not found");
  const archivedThreadIds = archiveEnvironmentThreads(deps, { environment });
  requestEnvironmentCleanup(deps, { environmentId });
  requestEnvironmentCleanupAdvance(deps, { environmentId });
  return { ok: true, action: request.action, archivedThreadIds };
}
