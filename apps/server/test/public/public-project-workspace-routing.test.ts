import { createProjectSource, updateProjectSource } from "@bb/db";
import type { HostProviderCommand } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const remoteCommand: HostProviderCommand = {
  name: "remote-only",
  source: "skill",
  origin: "project",
  description: "Remote command",
  argumentHint: null,
};
const primaryCommand: HostProviderCommand = {
  ...remoteCommand,
  name: "primary-only",
  description: "Primary command",
};

describe("public project workspace routing", () => {
  it("classifies the configured project path without adopting an ancestor repository", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-project-status-boundary",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/Users/jack/Documents/dataConductor",
      });
      const rpc = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (
            request.command.type !== "workspace.status" &&
            request.command.type !== "workspace.diffFiles"
          ) {
            throw new Error(`Unexpected status RPC ${request.command.type}`);
          }
          return {
            ok: true,
            result: {
              outcome: "unavailable",
              failure: {
                code: "not_git_repo",
                workspacePath: request.command.workspaceContext.workspacePath,
                message: "Not a Git repository",
              },
            },
          };
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/status`,
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "The configured project checkout is not a Git repository",
        resolvedSource: {
          hostId: host.id,
          path: "/Users/jack/Documents/dataConductor",
        },
      });
      const firstCommand = rpc.requests[0]?.command;
      if (firstCommand?.type !== "workspace.status") {
        throw new Error("Expected initial project workspace status command");
      }
      const firstRuntimeId = firstCommand.environmentId;
      expect(firstRuntimeId).toMatch(
        new RegExp(`^project-source:${project.id}:${host.id}:[0-9a-f]{16}$`, "u"),
      );
      expect(rpc.requests[0]?.command).toMatchObject({
        type: "workspace.status",
        workspaceContext: {
          workspacePath: "/Users/jack/Documents/dataConductor",
          workspaceProvisionType: "unmanaged",
        },
      });

      const diffResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/diff/files?target=uncommitted`,
      );
      expect(diffResponse.status).toBe(200);
      await expect(readJson(diffResponse)).resolves.toEqual({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "The configured project checkout is not a Git repository",
      });
      expect(rpc.requests[1]?.command).toMatchObject({
        type: "workspace.diffFiles",
        workspaceContext: {
          workspacePath: "/Users/jack/Documents/dataConductor",
        },
      });

      updateProjectSource(harness.db, harness.deps.hub, source.id, {
        path: "/Users/jack/Documents/dataConductor-moved",
      });
      const movedResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/status`,
      );
      expect(movedResponse.status).toBe(200);
      await expect(readJson(movedResponse)).resolves.toMatchObject({
        resolvedSource: {
          hostId: host.id,
          path: "/Users/jack/Documents/dataConductor-moved",
        },
      });
      expect(rpc.requests[2]?.command).toMatchObject({
        type: "workspace.status",
        workspaceContext: {
          workspacePath: "/Users/jack/Documents/dataConductor-moved",
        },
      });
      const movedCommand = rpc.requests[2]?.command;
      if (movedCommand?.type !== "workspace.status") {
        throw new Error("Expected moved project workspace status command");
      }
      expect(movedCommand.environmentId).not.toBe(firstRuntimeId);
    });
  });

  it("rejects a status environment owned by another project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-status-isolation",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/other/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: otherProject.id,
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/status?environmentId=${environment.id}`,
      );
      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_not_found",
      });
    });
  });

  it("runs a real project-default diff against the exact configured checkout", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-project-default-diff",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/safe/project",
      });
      const rpc = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "workspace.diffFiles") {
            throw new Error(`Unexpected project diff RPC ${request.command.type}`);
          }
          return {
            ok: true,
            result: {
              outcome: "available",
              files: [],
              shortstat: "",
              mergeBaseRef: null,
            },
          };
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/diff/files?target=uncommitted`,
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        outcome: "available",
        files: [],
        initialPatches: [],
      });
      expect(rpc.requests[0]?.command).toMatchObject({
        type: "workspace.diffFiles",
        workspaceContext: {
          workspacePath: "/safe/project",
          workspaceProvisionType: "unmanaged",
        },
        target: { type: "uncommitted" },
      });
    });
  });

  it("routes project diff patches and file sides inside the exact source root", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-project-diff-details",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/safe/project",
      });
      const rpc = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "workspace.diffPatch") {
            return {
              ok: true,
              result: {
                outcome: "available",
                patches: [
                  {
                    path: "src/demo.ts",
                    patch: "@@ -1 +1 @@",
                    truncated: false,
                  },
                ],
              },
            };
          }
          if (request.command.type === "workspace.status") {
            return {
              ok: true,
              result: {
                outcome: "available",
                workspaceStatus: {
                  workingTree: {
                    insertions: 0,
                    deletions: 0,
                    files: [],
                    hasUncommittedChanges: false,
                    state: "clean",
                  },
                  branch: { currentBranch: "feature", defaultBranch: "main" },
                  checkout: {
                    kind: "branch",
                    branchName: "feature",
                    headSha: null,
                  },
                  mergeBase: null,
                },
              },
            };
          }
          if (request.command.type === "host.read_file") {
            return {
              ok: true,
              result: {
                path: request.command.path,
                content: "old content",
                contentEncoding: "utf8",
                mimeType: "text/plain",
                sizeBytes: 11,
                sha256: "1".repeat(64),
              },
            };
          }
          throw new Error(`Unexpected detailed diff RPC ${request.command.type}`);
        },
      });

      const patchResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/diff/patch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: { type: "all", mergeBaseBranch: "main" },
            paths: ["src/demo.ts"],
          }),
        },
      );
      expect(patchResponse.status).toBe(200);
      expect(rpc.requests[0]?.command).toMatchObject({
        type: "workspace.diffPatch",
        workspaceContext: { workspacePath: "/safe/project" },
        target: { type: "all", mergeBaseBranch: "main" },
        paths: ["src/demo.ts"],
      });

      const fileResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/diff/file?target=all&side=old&mergeBaseRef=abc1234&path=src%2Fdemo.ts`,
      );
      expect(fileResponse.status).toBe(200);
      expect(rpc.requests[2]?.command).toMatchObject({
        type: "host.read_file",
        path: "/safe/project/src/demo.ts",
        rootPath: "/safe/project",
        ref: "abc1234",
      });

      const escapeResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/diff/file?target=uncommitted&side=new&path=..%2Fsecret.txt`,
      );
      expect(escapeResponse.status).toBe(400);
    });
  });

  it("isolates primary, explicit-host, and environment workspace discovery", async () => {
    await withTestHarness(async (harness) => {
      const { host: primaryHost, session: primarySession } = seedHostSession(
        harness.deps,
        { id: "host-project-routing-primary" },
      );
      const { host: remoteHost, session: remoteSession } = seedHostSession(
        harness.deps,
        { id: "host-project-routing-remote" },
      );
      seedPrimaryHost(harness.deps, primaryHost.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: primaryHost.id,
        path: "/primary/project",
      });
      createProjectSource(harness.db, harness.deps.hub, {
        projectId: project.id,
        hostId: remoteHost.id,
        path: "/remote/project",
        type: "local_path",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: remoteHost.id,
        projectId: project.id,
        path: "/remote/worktree",
      });

      registerHostRpcResponder(harness, {
        hostId: primaryHost.id,
        sessionId: primarySession.id,
        handle: (request) => {
          if (request.command.type === "host.list_files") {
            if (request.command.path !== "/primary/project") {
              return { ok: true, result: { files: [], truncated: false } };
            }
            return {
              ok: true,
              result: {
                files: [{ name: "primary.txt", path: "primary.txt" }],
                truncated: false,
              },
            };
          }
          if (request.command.type === "host.list_commands") {
            return { ok: true, result: { commands: [primaryCommand] } };
          }
          if (request.command.type === "host.read_file") {
            return {
              ok: true,
              result: {
                path: request.command.path,
                content: "content from /primary/project",
                contentEncoding: "utf8",
                mimeType: "text/plain",
                sizeBytes: 29,
                sha256: "2".repeat(64),
              },
            };
          }
          throw new Error(`Unexpected primary RPC ${request.command.type}`);
        },
      });
      const remoteRpc = registerHostRpcResponder(harness, {
        hostId: remoteHost.id,
        sessionId: remoteSession.id,
        handle: (request) => {
          if (request.command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          if (request.command.type === "host.list_paths") {
            return {
              ok: true,
              result: {
                paths: [
                  {
                    kind: "file",
                    name: "remote.txt",
                    path: "remote.txt",
                    positions: [],
                    score: 1,
                  },
                ],
                truncated: false,
              },
            };
          }
          if (request.command.type === "host.list_commands") {
            return { ok: true, result: { commands: [remoteCommand] } };
          }
          if (request.command.type === "host.read_file") {
            return {
              ok: true,
              result: {
                path: request.command.path,
                content: `content from ${request.command.rootPath}`,
                contentEncoding: "utf8",
                mimeType: "text/plain",
                sizeBytes: 28,
                sha256: "0".repeat(64),
              },
            };
          }
          throw new Error(`Unexpected remote RPC ${request.command.type}`);
        },
      });

      const primaryFiles = await harness.app.request(
        `/api/v1/projects/${project.id}/files`,
      );
      await expect(readJson(primaryFiles)).resolves.toEqual({
        files: [{ name: "primary.txt", path: "primary.txt" }],
        truncated: false,
      });
      const primaryCommands = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=codex`,
      );
      await expect(readJson(primaryCommands)).resolves.toMatchObject({
        commands: [
          expect.objectContaining({ name: "compact" }),
          primaryCommand,
        ],
      });
      const primaryContent = await harness.app.request(
        `/api/v1/projects/${project.id}/files/content?path=primary.txt`,
      );
      await expect(primaryContent.text()).resolves.toBe(
        "content from /primary/project",
      );

      const remotePaths = await harness.app.request(
        `/api/v1/projects/${project.id}/paths?hostId=${remoteHost.id}&includeFiles=true&includeDirectories=true`,
      );
      expect(remotePaths.status).toBe(200);
      expect(remoteRpc.requests.at(-1)?.command).toMatchObject({
        type: "host.list_paths",
        path: "/remote/project",
      });

      const environmentPaths = await harness.app.request(
        `/api/v1/projects/${project.id}/paths?environmentId=${environment.id}&includeFiles=true&includeDirectories=true`,
      );
      expect(environmentPaths.status).toBe(200);
      expect(remoteRpc.requests.at(-1)?.command).toMatchObject({
        type: "host.list_paths",
        path: "/remote/worktree",
      });

      const commands = await harness.app.request(
        `/api/v1/projects/${project.id}/commands?provider=codex&hostId=${remoteHost.id}`,
      );
      await expect(readJson(commands)).resolves.toMatchObject({
        commands: [expect.objectContaining({ name: "compact" }), remoteCommand],
      });
      expect(
        remoteRpc.requests.find(
          (request) => request.command.type === "host.list_commands",
        )?.command,
      ).toEqual({
        type: "host.list_commands",
        providerId: "codex",
        cwd: "/remote/project",
      });

      const content = await harness.app.request(
        `/api/v1/projects/${project.id}/files/content?hostId=${remoteHost.id}&path=remote.txt`,
      );
      expect(content.headers.get("x-bb-content-encoding")).toBe("utf8");
      await expect(content.text()).resolves.toBe(
        "content from /remote/project",
      );
    });
  });

  it("rejects simultaneous host and environment selectors on every project workspace route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-routing-conflict",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const selector = `hostId=${host.id}&environmentId=${environment.id}`;
      const urls = [
        `/api/v1/projects/${project.id}/status?${selector}`,
        `/api/v1/projects/${project.id}/diff/files?${selector}&target=uncommitted`,
        `/api/v1/projects/${project.id}/files?${selector}`,
        `/api/v1/projects/${project.id}/paths?${selector}&includeFiles=true&includeDirectories=true`,
        `/api/v1/projects/${project.id}/commands?${selector}&provider=codex`,
        `/api/v1/projects/${project.id}/files/content?${selector}&path=file.txt`,
      ];

      for (const url of urls) {
        const response = await harness.app.request(url);
        expect(response.status, url).toBe(400);
        await expect(readJson(response)).resolves.toMatchObject({
          message: expect.stringContaining("mutually exclusive"),
        });
      }
    });
  });

  it("preserves binary project file bytes and declares base64 SDK encoding", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-project-routing-binary",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/binary/project",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "host.read_file") {
            throw new Error(`Unexpected binary RPC ${request.command.type}`);
          }
          return {
            ok: true,
            result: {
              path: request.command.path,
              content: "AAH+/w==",
              contentEncoding: "base64",
              mimeType: "application/octet-stream",
              sizeBytes: 4,
              sha256: "1".repeat(64),
            },
          };
        },
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/files/content?path=image.bin`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/octet-stream",
      );
      expect(response.headers.get("x-bb-content-encoding")).toBe("base64");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array([0, 1, 254, 255]),
      );
    });
  });
});
