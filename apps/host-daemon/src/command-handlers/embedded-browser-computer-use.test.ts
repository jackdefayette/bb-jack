import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@bb/domain";
import { createEmbeddedBrowserComputerUseBridge } from "./embedded-browser-computer-use.js";

const dataDir = "/Users/jack/.bb-dev/documents-bb-jack-dadc42354ab7";
const userDataDir = `${dataDir}/desktop`;
const instanceId = "documents-bb-jack-dadc42354ab7";
const projectRoute = "/projects/proj-crm?workspace=acceptance";
const pageUrl = "http://127.0.0.1:5173/";

function createHarness(
  overrides: {
    identityPid?: number;
    pageIdentity?: { title: string; url: string };
  } = {},
) {
  const commands: Array<{ method: string; params: Record<string, JsonValue> }> =
    [];
  const pageIdentity = overrides.pageIdentity ?? {
    title: "Jack's CRM",
    url: pageUrl,
  };
  let now = 1_000;
  const client = {
    close: vi.fn(),
    send: vi.fn(
      async (
        method: string,
        params: Record<string, JsonValue> = {},
      ): Promise<JsonValue> => {
        commands.push({ method, params });
        if (method === "Runtime.evaluate") {
          const expression = String(params.expression ?? "");
          if (expression.includes("identifyForComputerUse")) {
            return {
              result: {
                value: JSON.stringify({
                  result: {
                    cdpTargetId: "crm-target",
                    tabId: "browser:crm",
                    url: pageUrl,
                  },
                }),
              },
            };
          }
          if (expression.includes("window.bbDesktop")) {
            return {
              result: {
                value: JSON.stringify({
                  result: {
                    capturedAtMs: 1_001,
                    dataUrl: "data:image/jpeg;base64,c2NyZWVuc2hvdA==",
                    tabId: "browser:crm",
                    url: pageUrl,
                  },
                }),
              },
            };
          }
          return {
            result: { value: JSON.stringify(pageIdentity) },
          };
        }
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [
              {
                backendDOMNodeId: 10,
                ignored: false,
                name: { value: "Log activity" },
                properties: [{ name: "disabled", value: { value: false } }],
                role: { value: "button" },
              },
              {
                backendDOMNodeId: 11,
                ignored: false,
                name: { value: "Activity note" },
                role: { value: "textbox" },
                value: { value: "" },
              },
              {
                backendDOMNodeId: 12,
                ignored: false,
                name: { value: "Maya Chen" },
                role: { value: "StaticText" },
              },
            ],
          };
        }
        if (method === "DOM.getBoxModel") {
          const backendNodeId = Number(params.backendNodeId ?? 0);
          const x = backendNodeId * 2;
          return {
            model: {
              border: [x, 10, x + 100, 10, x + 100, 40, x, 40],
            },
          };
        }
        return {};
      },
    ),
  };
  const runtime = {
    connectCdp: vi.fn(async () => client),
    fetchJson: vi.fn(async () => [
      {
        id: "host-target",
        title: "bb",
        type: "page",
        url: `http://localhost:14957${projectRoute}`,
        webSocketDebuggerUrl: "ws://127.0.0.1:61603/devtools/page/host-target",
      },
      {
        id: "crm-target",
        title: "Jack's CRM",
        type: "page",
        url: pageUrl,
        webSocketDebuggerUrl: "ws://127.0.0.1:61603/devtools/page/crm-target",
      },
      {
        id: "retained-crm-target",
        title: "Jack's CRM",
        type: "page",
        url: pageUrl,
        webSocketDebuggerUrl:
          "ws://127.0.0.1:61603/devtools/page/retained-crm-target",
      },
    ]),
    now: vi.fn(() => now++),
    randomId: vi
      .fn()
      .mockReturnValueOnce("target-id")
      .mockReturnValueOnce("tab-id"),
    readFile: vi.fn(async (filePath: string) => {
      if (filePath.endsWith("bb-computer-use-identity.json")) {
        return JSON.stringify({
          appUrl: "http://localhost:14957",
          instanceId,
          pid: overrides.identityPid ?? 700,
          startedAtMs: 500,
          userDataDir,
        });
      }
      if (filePath.endsWith("DevToolsActivePort")) {
        return "61603\n/devtools/browser/browser-id\n";
      }
      throw new Error(`unexpected file ${filePath}`);
    }),
  };
  const inspectNativeWindow = vi.fn(async () => ({
    pid: 700,
    title: `Jack's CRM [instance:${instanceId}] [window:main]`,
    windowId: 900,
  }));
  const bridge = createEmbeddedBrowserComputerUseBridge(runtime);
  return { bridge, client, commands, inspectNativeWindow, runtime };
}

async function bind(harness: ReturnType<typeof createHarness>) {
  const result = await harness.bridge.handle({
    arguments: {
      embedded: true,
      expected_project_route: projectRoute,
      expected_url: pageUrl,
      pid: 700,
      session: "crm-acceptance",
      window_id: 900,
    },
    dataDir,
    inspectNativeWindow: harness.inspectNativeWindow,
    tool: "get_browser_state",
  });
  expect(result).toMatchObject({
    instance_id: instanceId,
    page_url: pageUrl,
    project_route: projectRoute,
    tab_id: "bb-tab:tab-id",
    target_id: "bb-embedded:target-id",
  });
  return {
    session: "crm-acceptance",
    tab_id: "bb-tab:tab-id",
    target_id: "bb-embedded:target-id",
  };
}

describe("embedded Browser Computer Use bridge", () => {
  it("binds only the exact canonical pid, window identity, project route, and page URL", async () => {
    const harness = createHarness();
    await bind(harness);

    expect(harness.inspectNativeWindow).toHaveBeenCalledWith({
      instanceId,
      pid: 700,
      windowId: 900,
    });
    expect(harness.runtime.fetchJson).toHaveBeenCalledWith(
      "http://127.0.0.1:61603/json/list",
    );
  });

  it("refuses a generic or duplicate Electron pid before native inspection", async () => {
    const harness = createHarness({ identityPid: 701 });

    await expect(bind(harness)).rejects.toMatchObject({
      code: "computer_use_embedded_browser_wrong_instance",
    });
    expect(harness.inspectNativeWindow).not.toHaveBeenCalled();
  });

  it("captures fresh semantic state and screenshot, acts by a fresh ref, then verifies the page", async () => {
    const harness = createHarness();
    const target = await bind(harness);
    const snapshot = await harness.bridge.handle({
      arguments: {
        ...target,
        expected_project_route: projectRoute,
        expected_url: pageUrl,
        include_screenshot: true,
        snapshot_format: "semantic_v2",
      },
      dataDir,
      inspectNativeWindow: harness.inspectNativeWindow,
      tool: "get_browser_state",
    });
    expect(snapshot).toMatchObject({
      captured_at_ms: expect.any(Number),
      elements: expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          label: "Log activity",
          ref: "bbp00000001:0",
          role: "button",
        }),
      ]),
      page_url: pageUrl,
      project_route: projectRoute,
      screenshot: "data:image/jpeg;base64,c2NyZWVuc2hvdA==",
      snapshot_id: "bbp00000001",
    });

    const action = await harness.bridge.handle({
      arguments: { ...target, ref: "bbp00000001:0" },
      dataDir,
      inspectNativeWindow: harness.inspectNativeWindow,
      tool: "browser_click",
    });
    expect(action).toMatchObject({
      acted_at_ms: expect.any(Number),
      project_route: projectRoute,
    });
    expect(harness.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "Input.dispatchMouseEvent" }),
      ]),
    );

    await expect(
      harness.bridge.handle({
        arguments: { ...target, ref: "bbp00000001:0" },
        dataDir,
        inspectNativeWindow: harness.inspectNativeWindow,
        tool: "browser_click",
      }),
    ).rejects.toMatchObject({
      code: "computer_use_embedded_browser_stale_ref",
    });

    const verification = await harness.bridge.handle({
      arguments: {
        ...target,
        expect: [
          {
            element: {
              exists: true,
              selector: { label_contains: "Maya Chen", role: "StaticText" },
            },
          },
        ],
      },
      dataDir,
      inspectNativeWindow: harness.inspectNativeWindow,
      tool: "verify_state",
    });
    expect(verification).toMatchObject({
      project_route: projectRoute,
      satisfied: [expect.objectContaining({ index: 0 })],
      status: "satisfied",
      unknown: [],
      unsatisfied: [],
    });

    harness.bridge.releaseSession("crm-acceptance");
    await expect(
      harness.bridge.handle({
        arguments: target,
        dataDir,
        inspectNativeWindow: harness.inspectNativeWindow,
        tool: "get_browser_state",
      }),
    ).rejects.toMatchObject({
      code: "computer_use_embedded_browser_stale_target",
    });
  });

  it("refuses a stale frame when the live page URL differs from the bound URL", async () => {
    const harness = createHarness({
      pageIdentity: { title: "Other", url: "http://127.0.0.1:5173/other" },
    });
    const target = await bind(harness);

    await expect(
      harness.bridge.handle({
        arguments: { ...target, expected_url: pageUrl },
        dataDir,
        inspectNativeWindow: harness.inspectNativeWindow,
        tool: "get_browser_state",
      }),
    ).rejects.toMatchObject({
      code: "computer_use_embedded_browser_stale_frame",
    });
  });
});
