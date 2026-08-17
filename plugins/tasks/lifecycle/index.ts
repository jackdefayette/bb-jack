import type { BbPluginApi } from "@bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import type { TaskStatus, TaskThread, TaskThreadLiveStatus } from "../db";
import {
  createSystemComment,
  publishCommentsChanged,
  publishThreadsChanged,
} from "../delegate";

const TERMINAL_LIVE_STATUSES = new Set<TaskThreadLiveStatus>([
  "completed",
  "failed",
]);
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["done", "canceled"]);
export const THREAD_STATUS_RECONCILE_INTERVAL_MS = 5 * 60_000;
export const THREAD_STATUS_IDLE_INTERVAL_MS = 60_000;

type SdkThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

function liveStatusFromThread(thread: SdkThread): TaskThreadLiveStatus {
  if (thread.archivedAt !== null || thread.deletedAt !== null) {
    return "completed";
  }
  if (thread.status === "error") return "failed";

  switch (thread.status) {
    case "starting":
      return "starting";
    case "active":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
  }
}

function trackedThreads(store: TasksApiStore, threadId?: string): TaskThread[] {
  const tracked: TaskThread[] = [];
  for (const task of store.tasks.listTasks()) {
    for (const thread of store.tasks.listTaskThreads(task.id)) {
      if (threadId === undefined || thread.threadId === threadId) {
        tracked.push(thread);
      }
    }
  }
  return tracked;
}

function terminalCommentBody(
  thread: TaskThread,
  liveStatus: Extract<TaskThreadLiveStatus, "completed" | "failed">,
): string {
  return `Thread "${thread.title}" ${liveStatus} — final message posted · ${thread.threadId}`;
}

function sdkErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function finalizeTaskThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: TaskThread,
): Promise<void> {
  try {
    const liveThread = await bb.sdk.threads.get({
      threadId: thread.threadId,
    });
    if (liveThread.archivedAt === null && liveThread.deletedAt === null) {
      await archiveTaskThread(bb, store, thread);
      return;
    }
    transitionThread(bb, store, thread, "completed");
  } catch (error) {
    const errorCode = sdkErrorCode(error);
    if (
      errorCode === "thread_not_found" ||
      errorCode === "thread_environment_unavailable"
    ) {
      transitionThread(bb, store, thread, "completed");
      return;
    }
    bb.log.warn(
      `Could not automatically archive terminal task thread ${thread.threadId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function archiveTaskThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: TaskThread,
): Promise<void> {
  await bb.sdk.threads.archiveAll({ threadId: thread.threadId });
  transitionThread(bb, store, thread, "completed");
}

export async function finalizeTaskIfTerminal(
  bb: BbPluginApi,
  store: TasksApiStore,
  taskId: string,
): Promise<void> {
  const task = store.tasks.getTask(taskId);
  if (!task || !TERMINAL_TASK_STATUSES.has(task.status)) return;

  for (const thread of store.tasks.listTaskThreads(task.id)) {
    if (thread.liveStatus === "completed") continue;
    await finalizeTaskThread(bb, store, thread);
  }
}

async function finalizePendingTerminalTasks(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  for (const thread of store.tasks.listPendingTerminalTaskThreads()) {
    await finalizeTaskThread(bb, store, thread);
  }
}

async function finalizeTerminalPullRequests(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  const threadsByEnvironment = new Map<string, TaskThread[]>();
  for (const thread of store.tasks.listPendingReviewTaskThreads()) {
    try {
      const liveThread = await bb.sdk.threads.get({
        threadId: thread.threadId,
      });
      if (liveThread.archivedAt !== null || liveThread.deletedAt !== null) {
        transitionThread(bb, store, thread, "completed");
        continue;
      }
      if (!liveThread.environmentId) continue;
      const threads = threadsByEnvironment.get(liveThread.environmentId) ?? [];
      threads.push(thread);
      threadsByEnvironment.set(liveThread.environmentId, threads);
    } catch (error) {
      if (sdkErrorCode(error) === "thread_not_found") {
        transitionThread(bb, store, thread, "completed");
        continue;
      }
      bb.log.warn(
        `Could not inspect review task thread ${thread.threadId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const [environmentId, threads] of threadsByEnvironment) {
    try {
      const result = await bb.sdk.environments.pullRequest({ environmentId });
      if (
        result.outcome !== "available" ||
        (result.pullRequest.state !== "merged" &&
          result.pullRequest.state !== "closed")
      ) {
        continue;
      }
      for (const thread of threads) {
        await archiveTaskThread(bb, store, thread);
      }
    } catch (error) {
      bb.log.warn(
        `Could not automatically archive terminal pull request environment ${environmentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function transitionThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: TaskThread,
  liveStatus: TaskThreadLiveStatus,
): void {
  if (
    thread.liveStatus === liveStatus ||
    (TERMINAL_LIVE_STATUSES.has(thread.liveStatus) &&
      !(thread.liveStatus === "failed" && liveStatus === "completed"))
  ) {
    return;
  }

  store.transaction(() => {
    store.tasks.updateTaskThreadStatus(thread.id, liveStatus);
    if (
      !TERMINAL_LIVE_STATUSES.has(thread.liveStatus) &&
      (liveStatus === "completed" || liveStatus === "failed")
    ) {
      createSystemComment(store.tasks, {
        taskId: thread.taskId,
        presetName: thread.presetName,
        threadId: thread.threadId,
        body: terminalCommentBody(thread, liveStatus),
      });
    }
  });

  publishThreadsChanged(bb, thread.taskId);
  publishCommentsChanged(bb, thread.taskId);
}

function transitionTrackedThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  threadId: string,
  liveStatus: TaskThreadLiveStatus,
): void {
  for (const thread of trackedThreads(store, threadId)) {
    transitionThread(bb, store, thread, liveStatus);
  }
}

async function reconcileTrackedThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  trackedThread: TaskThread,
): Promise<void> {
  try {
    const thread = await bb.sdk.threads.get({
      threadId: trackedThread.threadId,
    });
    transitionThread(bb, store, trackedThread, liveStatusFromThread(thread));
  } catch (error) {
    if (sdkErrorCode(error) === "thread_not_found") {
      transitionThread(bb, store, trackedThread, "completed");
      return;
    }
    bb.log.warn(
      `Could not reconcile task thread ${trackedThread.threadId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function reconcileTrackedThreads(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  const nonTerminalThreads = trackedThreads(store).filter(
    (thread) => !TERMINAL_LIVE_STATUSES.has(thread.liveStatus),
  );

  for (const trackedThread of nonTerminalThreads) {
    await reconcileTrackedThread(bb, store, trackedThread);
  }
}

function hasNonTerminalTrackedThreads(store: TasksApiStore): boolean {
  return trackedThreads(store).some(
    (thread) => !TERMINAL_LIVE_STATUSES.has(thread.liveStatus),
  );
}

function hasPendingTerminalTaskThreads(store: TasksApiStore): boolean {
  return store.tasks.listPendingTerminalTaskThreads().length > 0;
}

function hasPendingReviewTaskThreads(store: TasksApiStore): boolean {
  return store.tasks.listPendingReviewTaskThreads().length > 0;
}

function waitForNextReconciliation(
  signal: AbortSignal,
  intervalMs: number,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function registerLifecycle(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  bb.events.on("thread.created", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, liveStatusFromThread(thread));
  });
  bb.events.on("thread.active", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "working");
  });
  bb.events.on("thread.idle", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "idle");
  });
  bb.events.on("thread.failed", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "failed");
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "completed");
  });

  // Lifecycle events cover live transitions without a full-SDK subscription.
  // Reconciliation remains a low-frequency recovery path for transitions that
  // happen while the plugin is unloaded or while a replacement is loading.
  bb.background.service("thread-status-reconcile", {
    async start(signal) {
      while (!signal.aborted) {
        if (
          !hasNonTerminalTrackedThreads(store) &&
          !hasPendingTerminalTaskThreads(store) &&
          !hasPendingReviewTaskThreads(store)
        ) {
          await waitForNextReconciliation(
            signal,
            THREAD_STATUS_IDLE_INTERVAL_MS,
          );
          continue;
        }
        await waitForNextReconciliation(
          signal,
          THREAD_STATUS_RECONCILE_INTERVAL_MS,
        );
        if (signal.aborted) break;
        await finalizePendingTerminalTasks(bb, store);
        await finalizeTerminalPullRequests(bb, store);
        await reconcileTrackedThreads(bb, store);
      }
    },
  });

  await finalizePendingTerminalTasks(bb, store);
  await finalizeTerminalPullRequests(bb, store);
  await reconcileTrackedThreads(bb, store);
  await reconcileTrackedThreads(bb, store);
}
