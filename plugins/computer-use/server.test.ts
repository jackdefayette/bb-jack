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
          : tool === "get_window_state"
            ? {
                snapshot_id: "s00000001",
                elements: [
                  {
                    element_index: 17,
                    element_token: "s00000001:17",
                    label: "Focus build chat",
                    role: "AXButton",
                  },
                ],
              }
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

  it("re-resolves a stable native target to a fresh token immediately before acting", async () => {
    const { bb, harness, computerUseCall } = createHarness();
    await computerUsePlugin(bb);

    await harness.callAgentTool("computer_use_act", {
      tool: "click",
      arguments: { session: "acceptance" },
      target: {
        pid: 90338,
        window_id: 50929,
        label: "Focus build chat",
        role: "AXButton",
      },
    });

    expect(computerUseCall).toHaveBeenNthCalledWith(
      1,
      "host-1",
      "get_window_state",
      {
        pid: 90338,
        window_id: 50929,
        query: "Focus build chat",
        include_screenshot: false,
      },
    );
    expect(computerUseCall).toHaveBeenNthCalledWith(2, "host-1", "click", {
      session: "acceptance",
      pid: 90338,
      window_id: 50929,
      element_token: "s00000001:17",
    });
  });

  it("refuses stale or ambiguous addressing when a stable target is requested", async () => {
    const { bb, harness, computerUseCall } = createHarness();
    await computerUsePlugin(bb);

    await expect(
      harness.callAgentTool("computer_use_act", {
        tool: "click",
        arguments: { element_token: "sdeadbeef:2" },
        target: {
          pid: 90338,
          window_id: 50929,
          label: "Focus build chat",
        },
      }),
    ).rejects.toThrow(
      "Do not combine target with element_token; the bridge resolves a fresh element token.",
    );
    expect(computerUseCall).not.toHaveBeenCalled();
  });

  it("exposes exact-tab Browser inspection and action tools", async () => {
    const { bb, harness, computerUseCall } = createHarness();
    await computerUsePlugin(bb);

    await harness.callAgentTool("computer_use_inspect", {
      tool: "get_browser_state",
      arguments: { pid: 90338, window_id: 50929, session: "acceptance" },
    });
    await harness.callAgentTool("computer_use_act", {
      tool: "browser_click",
      arguments: {
        target_id: "target-1",
        tab_id: "tab-1",
        session: "acceptance",
        ref: "p1:4",
      },
    });

    expect(computerUseCall).toHaveBeenNthCalledWith(
      1,
      "host-1",
      "get_browser_state",
      { pid: 90338, window_id: 50929, session: "acceptance" },
    );
    expect(computerUseCall).toHaveBeenNthCalledWith(
      2,
      "host-1",
      "browser_click",
      {
        target_id: "target-1",
        tab_id: "tab-1",
        session: "acceptance",
        ref: "p1:4",
      },
    );
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
