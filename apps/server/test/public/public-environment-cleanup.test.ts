import { describe, expect, it } from "vitest";
import { getEnvironment, getThread } from "@bb/db";
import type { WorkspaceStatus } from "@bb/domain";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function status(
  state: WorkspaceStatus["workingTree"]["state"],
): WorkspaceStatus {
  const dirty = state !== "clean" && state !== "committed_unmerged";
  const committed =
    state === "committed_unmerged" || state === "dirty_and_committed_unmerged";
  return {
    workingTree: {
      insertions: dirty ? 1 : 0,
      deletions: 0,
      files: dirty
        ? [
            {
              path: state === "untracked" ? "new.txt" : "tracked.txt",
              status: state === "untracked" ? "??" : "M",
              insertions: state === "untracked" ? null : 1,
              deletions: state === "untracked" ? null : 0,
            },
          ]
        : [],
      hasUncommittedChanges: dirty,
      state,
    },
    checkout: { kind: "branch", branchName: "bb/test", headSha: "abc123" },
    branch: { currentBranch: "bb/test", defaultBranch: "main" },
    mergeBase: {
      mergeBaseBranch: "main",
      baseRef: "base123",
      aheadCount: committed ? 1 : 0,
      behindCount: 0,
      hasCommittedUnmergedChanges: committed,
      commits: committed
        ? [
            {
              sha: "abc123",
              shortSha: "abc123",
              subject: "valuable work",
              authorName: "Test",
              authoredAt: 1,
            },
          ]
        : [],
      files: committed
        ? [{ path: "committed.txt", status: "A", insertions: 1, deletions: 0 }]
        : [],
      insertions: committed ? 1 : 0,
      deletions: 0,
    },
  };
}

async function answerPreflight(
  harness: TestAppHarness,
  environmentId: string,
  workspaceStatus: WorkspaceStatus,
) {
  const request = harness.app.request(
    `/api/v1/environments/${environmentId}/cleanup`,
  );
  const command = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workspace.status" &&
      command.environmentId === environmentId,
  );
  await reportQueuedCommandSuccess(harness, command, {
    outcome: "available",
    workspaceStatus,
  });
  return readJson(await request);
}

function seedManagedFixture(
  harness: TestAppHarness,
  threadStatus: "idle" | "active" = "idle",
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    managed: true,
    workspaceProvisionType: "managed-worktree",
    path: `/tmp/${environmentSeed++}/working-copy`,
    mergeBaseBranch: "main",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: threadStatus,
    title: "BBJ fixture",
  });
  return { environment, host, project, thread };
}

let environmentSeed = 1;

describe("working-copy cleanup", () => {
  it.each([
    ["clean", "safe_delete"],
    ["dirty_uncommitted", "discard"],
    ["untracked", "discard"],
    ["committed_unmerged", "keep_branch"],
  ] as const)("classifies %s work", async (workspaceState, expected) => {
    await withTestHarness(async (harness) => {
      const { environment } = seedManagedFixture(harness);
      await expect(
        answerPreflight(harness, environment.id, status(workspaceState)),
      ).resolves.toMatchObject({ recommendedAction: expected });
    });
  });

  it("does not call a clean branch safe when merged status is unavailable", async () => {
    await withTestHarness(async (harness) => {
      const { environment } = seedManagedFixture(harness);
      const workspaceStatus = status("clean");
      workspaceStatus.mergeBase = null;

      await expect(
        answerPreflight(harness, environment.id, workspaceStatus),
      ).resolves.toMatchObject({
        recommendedAction: null,
        allowedActions: ["detach_thread"],
      });
    });
  });

  it("protects the canonical project folder without issuing a Git command", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: source.path,
      });
      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/cleanup`,
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        protectedCanonicalFolder: true,
        allowedActions: [],
      });
    });
  });

  it("detaches one task without retiring the shared working copy", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project, thread } = seedManagedFixture(harness);
      const peer = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        title: "Peer task",
      });
      const preflightPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/cleanup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "detach_thread",
            threadId: thread.id,
          }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.status",
      );
      await reportQueuedCommandSuccess(harness, command, {
        outcome: "available",
        workspaceStatus: status("clean"),
      });
      expect((await preflightPromise).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(getThread(harness.db, peer.id)?.archivedAt).toBeNull();
      expect(getEnvironment(harness.db, environment.id)?.status).toBe("ready");
    });
  });

  it("refuses removal while another active task shares the working copy", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project, thread } = seedManagedFixture(harness);
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
        title: "Active peer",
      });
      const request = harness.app.request(
        `/api/v1/environments/${environment.id}/cleanup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "discard",
            threadId: thread.id,
            confirmation: environment.id,
          }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.status",
      );
      await reportQueuedCommandSuccess(harness, command, {
        outcome: "available",
        workspaceStatus: status("dirty_uncommitted"),
      });
      const response = await request;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "working_copy_in_use",
      });
    });
  });

  it.each([
    ["safe_delete", "clean", false, true],
    ["keep_branch", "committed_unmerged", false, false],
  ] as const)(
    "archives history and dispatches %s with the expected host policy",
    async (action, workspaceState, force, deleteBranch) => {
      await withTestHarness(async (harness) => {
        const { environment, thread } = seedManagedFixture(harness);
        const request = harness.app.request(
          `/api/v1/environments/${environment.id}/cleanup`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, threadId: thread.id }),
          },
        );
        const statusCommand = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "workspace.status",
        );
        await reportQueuedCommandSuccess(harness, statusCommand, {
          outcome: "available",
          workspaceStatus: status(workspaceState),
        });
        expect((await request).status).toBe(200);

        const destroyCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.destroy" &&
            command.environmentId === environment.id,
        );
        expect(destroyCommand.command).toMatchObject({
          type: "environment.destroy",
          force,
          deleteBranch,
        });
        await reportQueuedCommandSuccess(harness, destroyCommand, {});
        expect(getEnvironment(harness.db, environment.id)?.status).toBe(
          "destroyed",
        );
        expect(getThread(harness.db, thread.id)).toMatchObject({
          archivedAt: expect.any(Number),
          deletedAt: null,
        });
      });
    },
  );
});
