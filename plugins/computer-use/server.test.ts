import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import type {
  JsonValue,
  PluginComputerUseResult,
  PluginComputerUseToolName,
} from "@bb/plugin-sdk";
import computerUsePlugin from "./server.js";

const host = {
  id: "host-1",
  name: "Jack's Mac",
  type: "persistent" as const,
  status: "connected" as const,
  maxPermissionMode: "accept-edits" as const,
  lastSeenAt: 1,
  lastRejectedProtocolVersion: null,
  createdAt: 1,
  updatedAt: 1,
};

function createHarness() {
  const computerUseCall = vi.fn(
    async (
      _hostId: string,
      tool: PluginComputerUseToolName,
      args: Readonly<Record<string, JsonValue>>,
    ): Promise<PluginComputerUseResult> => ({
      tool,
      result:
        tool === "check_permissions"
          ? { accessibility: true, screen_recording: true }
          : { args: { ...args }, ok: true },
    }),
  );
  const fake = createFakePluginHost({
    agentSkillIds: ["computer-use"],
    computerUseCall,
    sdk: {
      hosts: { list: async () => [host] },
      threads: {
        get: async () => ({ id: "thread-1", host }),
      },
    },
  });
  return { ...fake, computerUseCall };
}

describe("computer-use plugin", () => {
  it("reports host permission status through typed RPC", async () => {
    const { bb, harness, computerUseCall } = createHarness();
    await computerUsePlugin(bb);

    await expect(harness.callRpc("status", null)).resolves.toEqual({
      hosts: [
        {
          hostId: "host-1",
          hostName: "Jack's Mac",
          connected: true,
          permissions: { accessibility: true, screen_recording: true },
          error: null,
        },
      ],
    });
    expect(computerUseCall).toHaveBeenCalledWith(
      "host-1",
      "check_permissions",
      {},
    );
  });

  it("routes agent tools to the thread execution host", async () => {
    const { bb, harness, computerUseCall } = createHarness();
    await computerUsePlugin(bb);

    await expect(
      harness.callAgentTool("computer_use_inspect", {
        tool: "get_screen_size",
        arguments: {},
      }),
    ).resolves.toMatchObject({
      content: [expect.objectContaining({ type: "text" })],
    });
    expect(harness.sdk.callsTo("threads.get")).toEqual([
      [{ threadId: "thread-test", include: "host" }],
    ]);
    expect(computerUseCall).toHaveBeenCalledWith(
      "host-1",
      "get_screen_size",
      {},
    );
  });

  it("selects the skill and bounded inspect/act/verify tool set", async () => {
    const { bb, harness } = createHarness();
    await computerUsePlugin(bb);

    const resolved = await harness.resolveAgentConfiguration({
      thread: {
        id: "thread-1",
        title: "Computer use",
        parentThreadId: null,
        sourceThreadId: null,
      },
      project: {
        id: "project-1",
        kind: "standard",
        name: "Project",
        gitRemoteUrl: null,
      },
      environment: {
        id: "environment-1",
        name: null,
        path: "/tmp/project",
        workspaceProvisionType: "unmanaged",
        branchName: null,
      },
      host: { id: "host-1", name: "Jack's Mac" },
      provider: { id: "codex", model: "gpt-5" },
      origin: { kind: null, pluginId: null },
    });

    expect(resolved.skills).toEqual(["computer-use"]);
    expect(resolved.tools.map((tool) => tool.name)).toEqual([
      "computer_use_inspect",
      "computer_use_act",
      "computer_use_verify",
    ]);
  });

  it("registers status and call CLI commands", async () => {
    const { bb, harness } = createHarness();
    await computerUsePlugin(bb);

    await expect(harness.runCli(["status", "--json"])).resolves.toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    await expect(
      harness.runCli(["call", "get_screen_size", "--args", "{}", "--json"], {
        threadId: "thread-1",
      }),
    ).resolves.toMatchObject({ exitCode: 0, stderr: "" });
  });
});
