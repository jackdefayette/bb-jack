import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "../api";
import type { TaskThreadLiveStatus } from "../db";
import {
  registerLifecycle,
  THREAD_STATUS_IDLE_INTERVAL_MS,
  THREAD_STATUS_RECONCILE_INTERVAL_MS,
} from ".";

interface TrackedThreadFixture {
  bb: ReturnType<typeof createFakePluginHost>["bb"];
  harness: ReturnType<typeof createFakePluginHost>["harness"];
  store: ReturnType<typeof createStore>;
  taskId: string;
  taskThreadId: string;
}

function safeCleanupPreflight(
  environmentId: string,
  liveThreads: ReadonlyArray<{
    id: string;
    status?: "idle" | "starting" | "active" | "stopping" | "error";
  }>,
) {
  return {
    environment: {
      id: environmentId,
      name: null,
      branchName: "bb/review",
      path: `/tmp/${environmentId}`,
      status: "ready" as const,
      updatedAt: 1,
    },
    protectedCanonicalFolder: false,
    liveThreads: liveThreads.map((thread) => ({
      id: thread.id,
      title: null,
      status: thread.status ?? ("idle" as const),
    })),
    workspace: null,
    workspaceUnavailableReason: null,
    allowedActions: ["detach_thread", "safe_delete"] as const,
    recommendedAction: "safe_delete" as const,
    summary: "Clean, merged, and inactive.",
  };
}

function trackedThreadFixture(
  liveStatus: TaskThreadLiveStatus,
  sdkStatus: "idle" | "starting" | "active" | "stopping" | "error",
): TrackedThreadFixture {
  const host = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      threads: {
        get: async () =>
          makeThreadResponse({
            id: "thr_worker",
            title: "Lifecycle worker",
            status: sdkStatus,
          }),
      },
    },
  });
  const store = createStore(host.bb);
  const project = store.tasks.createProject({
    name: "Tasks plugin",
    prefix: "TASK",
    color: "blue",
  });
  const task = store.tasks.createTask({
    projectId: project.id,
    title: "Track lifecycle",
  });
  const taskThread = store.tasks.upsertTaskThread({
    taskId: task.id,
    threadId: "thr_worker",
    presetName: "GPT-5.6 · high",
    title: "Lifecycle worker",
    liveStatus,
  });

  return {
    ...host,
    store,
    taskId: task.id,
    taskThreadId: taskThread.id,
  };
}

describe("task thread lifecycle", () => {
  it.each(["merged", "closed"] as const)(
    "automatically cleans an in-review working copy when its pull request is %s",
    async (pullRequestState) => {
      const host = createFakePluginHost({
        pluginId: "tasks",
        sdk: {
          threads: {
            get: async () =>
              makeThreadResponse({
                id: "thr_review",
                environmentId: "env_review",
                status: "idle",
              }),
          },
          environments: {
            pullRequest: async () => ({
              outcome: "available",
              pullRequest: { state: pullRequestState },
            }),
            cleanupPreflight: async () =>
              safeCleanupPreflight("env_review", [{ id: "thr_review" }]),
            cleanup: async () => ({
              ok: true,
              action: "safe_delete",
              archivedThreadIds: ["thr_review"],
            }),
          },
        },
      });
      const store = createStore(host.bb);
      const project = store.tasks.createProject({
        name: "Pull request lifecycle",
        prefix: "PR",
        color: "blue",
      });
      const task = store.tasks.createTask({
        projectId: project.id,
        title: "Review pull request",
        status: "in_review",
      });
      const tracked = store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId: "thr_review",
        presetName: "Default",
        title: "Review worker",
        liveStatus: "idle",
      });

      await registerLifecycle(host.bb, store);

      expect(host.harness.sdk.callsTo("environments.pullRequest")).toEqual([
        [{ environmentId: "env_review" }],
      ]);
      expect(host.harness.sdk.callsTo("environments.cleanup")).toEqual([
        [{ environmentId: "env_review", action: "safe_delete" }],
      ]);
      expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe(
        "completed",
      );

      await host.harness.dispose();
    },
  );

  it("automatically cleans a safe in-review working copy without a pull request", async () => {
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_review",
              environmentId: "env_review",
              status: "idle",
            }),
        },
        environments: {
          pullRequest: async () => ({ outcome: "absent" }),
          cleanupPreflight: async () =>
            safeCleanupPreflight("env_review", [{ id: "thr_review" }]),
          cleanup: async () => ({
            ok: true,
            action: "safe_delete",
            archivedThreadIds: ["thr_review"],
          }),
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Review cleanup",
      prefix: "REVIEW",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Ready without a pull request",
      status: "in_review",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_review",
      presetName: "Default",
      title: "Review worker",
      liveStatus: "idle",
    });

    await registerLifecycle(host.bb, store);

    expect(host.harness.sdk.callsTo("environments.cleanup")).toEqual([
      [{ environmentId: "env_review", action: "safe_delete" }],
    ]);
    expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("completed");

    await host.harness.dispose();
  });

  it("keeps a shared working copy while another attached task is still in progress", async () => {
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async ({ threadId }) =>
            makeThreadResponse({
              id: threadId,
              environmentId: "env_shared",
              status: "idle",
            }),
        },
        environments: {
          pullRequest: async () => ({ outcome: "absent" }),
          cleanupPreflight: async () =>
            safeCleanupPreflight("env_shared", [
              { id: "thr_review" },
              { id: "thr_active_task" },
            ]),
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Shared review cleanup",
      prefix: "SHARED",
      color: "blue",
    });
    const reviewTask = store.tasks.createTask({
      projectId: project.id,
      title: "Ready task",
      status: "in_review",
    });
    const activeTask = store.tasks.createTask({
      projectId: project.id,
      title: "Active task",
      status: "in_progress",
    });
    store.tasks.upsertTaskThread({
      taskId: reviewTask.id,
      threadId: "thr_review",
      presetName: "Default",
      title: "Review worker",
      liveStatus: "idle",
    });
    store.tasks.upsertTaskThread({
      taskId: activeTask.id,
      threadId: "thr_active_task",
      presetName: "Default",
      title: "Active task worker",
      liveStatus: "idle",
    });

    await registerLifecycle(host.bb, store);

    expect(host.harness.sdk.callsTo("environments.cleanup")).toEqual([]);
    expect(store.tasks.listTaskThreads(reviewTask.id)[0]?.liveStatus).toBe(
      "idle",
    );

    await host.harness.dispose();
  });

  it("removes a clean unmerged working copy while preserving its branch", async () => {
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_unmerged",
              environmentId: "env_unmerged",
              status: "idle",
            }),
        },
        environments: {
          pullRequest: async () => ({
            outcome: "available",
            pullRequest: { state: "closed" },
          }),
          cleanupPreflight: async () => ({
            ...safeCleanupPreflight("env_unmerged", [{ id: "thr_unmerged" }]),
            allowedActions: ["detach_thread", "keep_branch"] as const,
            recommendedAction: "keep_branch" as const,
            summary: "Committed work is not merged.",
          }),
          cleanup: async () => ({
            ok: true,
            action: "keep_branch",
            archivedThreadIds: ["thr_unmerged"],
          }),
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Unmerged review cleanup",
      prefix: "UNMERGED",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Closed pull request",
      status: "in_review",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_unmerged",
      presetName: "Default",
      title: "Unmerged worker",
      liveStatus: "idle",
    });

    await registerLifecycle(host.bb, store);

    expect(host.harness.sdk.callsTo("environments.cleanup")).toEqual([
      [{ environmentId: "env_unmerged", action: "keep_branch" }],
    ]);
    expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("completed");

    await host.harness.dispose();
  });

  it("preserves an in-review working copy when cleanup would discard changes", async () => {
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_dirty",
              environmentId: "env_dirty",
              status: "idle",
            }),
        },
        environments: {
          pullRequest: async () => ({ outcome: "absent" }),
          cleanupPreflight: async () => ({
            ...safeCleanupPreflight("env_dirty", [{ id: "thr_dirty" }]),
            allowedActions: ["detach_thread", "discard"] as const,
            recommendedAction: "discard" as const,
            summary: "Tracked or untracked changes would be lost.",
          }),
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Dirty review cleanup",
      prefix: "DIRTY",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Preserve valuable work",
      status: "in_review",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_dirty",
      presetName: "Default",
      title: "Dirty worker",
      liveStatus: "idle",
    });

    await registerLifecycle(host.bb, store);

    expect(host.harness.sdk.callsTo("environments.cleanup")).toEqual([]);
    expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("idle");

    await host.harness.dispose();
  });

  it("keeps an in-review thread while its pull request is still open", async () => {
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_open_review",
              environmentId: "env_open_review",
              status: "idle",
            }),
        },
        environments: {
          pullRequest: async () => ({
            outcome: "available",
            pullRequest: { state: "open" },
          }),
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Open pull request",
      prefix: "OPEN",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Still reviewing",
      status: "in_review",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_open_review",
      presetName: "Default",
      title: "Open review worker",
      liveStatus: "idle",
    });

    await registerLifecycle(host.bb, store);

    expect(host.harness.sdk.callsTo("threads.archiveAll")).toEqual([]);
    expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("idle");

    await host.harness.dispose();
  });

  it("moves a working thread to completed, comments, and publishes", async () => {
    const fixture = trackedThreadFixture("working", "active");
    await registerLifecycle(fixture.bb, fixture.store);

    await fixture.harness.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({
        id: "thr_worker",
        title: "Lifecycle worker",
        deletedAt: Date.now(),
      }),
    });

    expect(
      fixture.store.tasks.getTaskThread(fixture.taskThreadId)?.liveStatus,
    ).toBe("completed");
    expect(fixture.store.tasks.listComments(fixture.taskId)).toContainEqual(
      expect.objectContaining({
        kind: "system",
        authorName: "Tasks",
        presetName: "GPT-5.6 · high",
        threadId: "thr_worker",
        body: 'Thread "Lifecycle worker" completed — final message posted · thr_worker',
      }),
    );
    expect(fixture.harness.realtimeSignals).toEqual([
      { channel: "threads:changed", payload: { taskId: fixture.taskId } },
      { channel: "comments:changed", payload: { taskId: fixture.taskId } },
    ]);

    await fixture.harness.dispose();
  });

  it("moves a working thread to failed, comments, and publishes", async () => {
    const fixture = trackedThreadFixture("working", "active");
    await registerLifecycle(fixture.bb, fixture.store);

    await fixture.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({
        id: "thr_worker",
        title: "Lifecycle worker",
        status: "error",
      }),
      error: "provider exited",
    });

    expect(
      fixture.store.tasks.getTaskThread(fixture.taskThreadId)?.liveStatus,
    ).toBe("failed");
    expect(fixture.store.tasks.listComments(fixture.taskId)).toContainEqual(
      expect.objectContaining({
        kind: "system",
        body: 'Thread "Lifecycle worker" failed — final message posted · thr_worker',
      }),
    );
    expect(fixture.harness.realtimeSignals).toEqual([
      { channel: "threads:changed", payload: { taskId: fixture.taskId } },
      { channel: "comments:changed", payload: { taskId: fixture.taskId } },
    ]);

    await fixture.harness.dispose();
  });

  it("reconciles a stale non-terminal row on load", async () => {
    const fixture = trackedThreadFixture("starting", "idle");

    await registerLifecycle(fixture.bb, fixture.store);

    expect(fixture.harness.sdk.callsTo("threads.get")).toEqual([
      [{ threadId: "thr_worker" }],
      [{ threadId: "thr_worker" }],
    ]);
    expect(
      fixture.store.tasks.getTaskThread(fixture.taskThreadId)?.liveStatus,
    ).toBe("idle");
    expect(fixture.harness.realtimeSignals).toEqual([
      { channel: "threads:changed", payload: { taskId: fixture.taskId } },
      { channel: "comments:changed", payload: { taskId: fixture.taskId } },
    ]);

    await fixture.harness.dispose();
  });

  it("registers all lifecycle listeners before startup reconciliation", async () => {
    let handlersAtFirstRead:
      | ReturnType<
          typeof createFakePluginHost
        >["harness"]["registrations"]["threadEventHandlers"]
      | undefined;
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () => {
            handlersAtFirstRead =
              host.harness.registrations.threadEventHandlers;
            return makeThreadResponse({
              id: "thr_fast",
              status: "starting",
            });
          },
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Fast lifecycle",
      prefix: "FAST",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Catch active",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_fast",
      presetName: "Default",
      title: "Fast worker",
      liveStatus: "starting",
    });

    await registerLifecycle(host.bb, store);

    expect(handlersAtFirstRead).toEqual({
      "thread.created": 1,
      "thread.active": 1,
      "thread.idle": 1,
      "thread.failed": 1,
      "thread.archived": 0,
      "thread.deleted": 1,
    });
    expect(host.harness.sdk.callsTo("threads.get")).toHaveLength(2);
    expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("starting");

    await host.harness.dispose();
  });

  it("moves a starting thread to working from thread.active without an SDK subscription", async () => {
    const fixture = trackedThreadFixture("starting", "starting");
    await registerLifecycle(fixture.bb, fixture.store);

    await fixture.harness.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({
        id: "thr_worker",
        title: "Lifecycle worker",
        status: "active",
      }),
    });

    expect(
      fixture.store.tasks.getTaskThread(fixture.taskThreadId)?.liveStatus,
    ).toBe("working");
    expect(fixture.harness.sdk.callsTo("threads.get")).toHaveLength(2);
    expect(fixture.harness.sdk.callsTo("subscribe")).toEqual([]);

    await fixture.harness.dispose();
  });

  it("sweeps active threads every five minutes as a missed-event safety net", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () => {
            reads += 1;
            return makeThreadResponse({
              id: "thr_safety_net",
              status: reads <= 2 ? "starting" : "active",
            });
          },
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Safety net lifecycle",
      prefix: "SAFE",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Recover a missed event",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_safety_net",
      presetName: "Default",
      title: "Safety net worker",
      liveStatus: "starting",
    });

    try {
      await registerLifecycle(host.bb, store);
      const service = host.harness.runService("thread-status-reconcile");

      await vi.advanceTimersByTimeAsync(
        THREAD_STATUS_RECONCILE_INTERVAL_MS - 1,
      );
      expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe(
        "starting",
      );

      await vi.advanceTimersByTimeAsync(1);
      expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("working");
      expect(host.harness.sdk.callsTo("subscribe")).toEqual([]);
      service.controller.abort();
      await service.done;
    } finally {
      vi.useRealTimers();
      await host.harness.dispose();
    }
  });

  it("backs off reconciliation while no non-terminal task threads exist", async () => {
    vi.useFakeTimers();
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({ id: "thr_later", status: "active" }),
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Idle polling",
      prefix: "IDLE",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Attach later",
    });

    try {
      await registerLifecycle(host.bb, store);
      const service = host.harness.runService("thread-status-reconcile");
      const tracked = store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId: "thr_later",
        presetName: "Default",
        title: "Later worker",
        liveStatus: "starting",
      });

      await vi.advanceTimersByTimeAsync(THREAD_STATUS_IDLE_INTERVAL_MS);
      expect(host.harness.sdk.callsTo("threads.get")).toEqual([]);

      await vi.advanceTimersByTimeAsync(
        THREAD_STATUS_RECONCILE_INTERVAL_MS - 1,
      );
      expect(host.harness.sdk.callsTo("threads.get")).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(host.harness.sdk.callsTo("threads.get")).toEqual([
        [{ threadId: "thr_later" }],
      ]);
      expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("working");

      service.controller.abort();
      await service.done;
    } finally {
      vi.useRealTimers();
      await host.harness.dispose();
    }
  });

  it("retries automatic terminal-task archiving after a transient failure", async () => {
    vi.useFakeTimers();
    let archiveAttempts = 0;
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({ id: "thr_terminal", status: "idle" }),
          archiveAll: async () => {
            archiveAttempts += 1;
            if (archiveAttempts === 1) {
              throw new Error("server temporarily unavailable");
            }
            return { archivedThreadIds: [] };
          },
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Terminal retry",
      prefix: "RETRY",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Archive automatically",
      status: "done",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_terminal",
      presetName: "Default",
      title: "Terminal worker",
      liveStatus: "idle",
    });

    try {
      await registerLifecycle(host.bb, store);
      expect(archiveAttempts).toBe(1);
      expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("idle");

      const service = host.harness.runService("thread-status-reconcile");
      await vi.advanceTimersByTimeAsync(THREAD_STATUS_RECONCILE_INTERVAL_MS);

      expect(archiveAttempts).toBe(2);
      expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe(
        "completed",
      );
      service.controller.abort();
      await service.done;
    } finally {
      vi.useRealTimers();
      await host.harness.dispose();
    }
  });

  it("completes a terminal task whose working-copy environment is already gone", async () => {
    const host = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({ id: "thr_orphaned", status: "error" }),
          archiveAll: async () => {
            throw Object.assign(
              new Error("Thread environment is unavailable"),
              {
                code: "thread_environment_unavailable",
              },
            );
          },
        },
      },
    });
    const store = createStore(host.bb);
    const project = store.tasks.createProject({
      name: "Orphaned terminal task",
      prefix: "ORPHAN",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Already discarded",
      status: "canceled",
    });
    const tracked = store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_orphaned",
      presetName: "Default",
      title: "Orphaned worker",
      liveStatus: "failed",
    });

    await registerLifecycle(host.bb, store);

    expect(host.harness.sdk.callsTo("threads.archiveAll")).toEqual([
      [{ threadId: "thr_orphaned" }],
    ]);
    expect(store.tasks.getTaskThread(tracked.id)?.liveStatus).toBe("completed");
    expect(store.tasks.listComments(task.id)).toEqual([]);

    await host.harness.dispose();
  });

  it("ignores lifecycle events for non-tracked threads", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    await registerLifecycle(bb, store);

    await harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thr_untracked", status: "error" }),
      error: "not ours",
    });

    expect(harness.realtimeSignals).toEqual([]);
    expect(store.tasks.listTasks()).toEqual([]);

    await harness.dispose();
  });
});
