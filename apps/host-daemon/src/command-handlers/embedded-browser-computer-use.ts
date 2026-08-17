import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { WebSocket, type RawData } from "ws";
import type { JsonValue } from "@bb/domain";
import type { ComputerUseToolName } from "@bb/host-daemon-contract";

const COMPUTER_USE_IDENTITY_FILE = "bb-computer-use-identity.json";
const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";
const CDP_TIMEOUT_MS = 5_000;
const MAX_AX_ELEMENTS = 400;
const MAX_SCREENSHOT_BASE64_LENGTH = 8_388_608;
const EMBEDDED_TARGET_PREFIX = "bb-embedded:";
const EMBEDDED_TAB_PREFIX = "bb-tab:";

interface CdpClient {
  close(): void;
  send(method: string, params?: Record<string, JsonValue>): Promise<JsonValue>;
}

interface EmbeddedBrowserRuntime {
  connectCdp(url: string): Promise<CdpClient>;
  fetchJson(url: string): Promise<JsonValue>;
  now(): number;
  randomId(): string;
  readFile(filePath: string): Promise<string>;
}

interface EmbeddedBrowserIdentity {
  appUrl: string;
  instanceId: string;
  pid: number;
  startedAtMs: number;
  userDataDir: string;
}

interface DevToolsEndpoint {
  port: number;
}

interface DevToolsTarget {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface NativeWindowIdentity {
  pid: number;
  windowId: number;
  title: string;
}

interface EmbeddedBinding {
  appUrl: string;
  cdpTargetId: string;
  dataDir: string;
  desktopTabId: string;
  expectedUrl: string;
  hostCdpTargetId: string;
  hostWebSocketDebuggerUrl: string;
  instanceId: string;
  native: NativeWindowIdentity;
  projectRoute: string;
  refs: Map<string, number>;
  session: string;
  snapshotSequence: number;
  tabId: string;
  targetId: string;
  webSocketDebuggerUrl: string;
}

interface HandleEmbeddedBrowserCallArgs {
  arguments: Readonly<Record<string, JsonValue>>;
  dataDir: string;
  inspectNativeWindow(args: {
    instanceId: string;
    pid: number;
    windowId: number;
  }): Promise<NativeWindowIdentity>;
  tool: ComputerUseToolName;
}

interface EmbeddedSnapshotElement {
  bounds: { height: number; width: number; x: number; y: number } | null;
  description: string | null;
  enabled: boolean | null;
  focused: boolean | null;
  label: string;
  ref: string;
  role: string;
  selected: boolean | null;
  value: string | null;
}

interface EmbeddedSnapshot {
  captured_at: string;
  captured_at_ms: number;
  elements: EmbeddedSnapshotElement[];
  outline: string;
  page_title: string;
  page_url: string;
  project_route: string;
  screenshot?: string;
  snapshot_format: "semantic_v2";
  snapshot_id: string;
  tab_id: string;
  target_id: string;
}

interface AxValue {
  value?: JsonValue;
}

interface AxProperty {
  name?: string;
  value?: AxValue;
}

interface AxNode {
  backendDOMNodeId?: number;
  description?: AxValue;
  ignored?: boolean;
  name?: AxValue;
  properties?: AxProperty[];
  role?: AxValue;
  value?: AxValue;
}

interface NodeBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

export class EmbeddedBrowserComputerUseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddedBrowserComputerUseError";
  }
}

class WebSocketCdpClient implements CdpClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      reject(error: Error): void;
      resolve(value: JsonValue): void;
      timeout: NodeJS.Timeout;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (raw: RawData) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!isRecord(payload) || typeof payload.id !== "number") return;
      const pending = this.pending.get(payload.id);
      if (pending === undefined) return;
      this.pending.delete(payload.id);
      clearTimeout(pending.timeout);
      if (isRecord(payload.error)) {
        pending.reject(
          new Error(
            typeof payload.error.message === "string"
              ? payload.error.message
              : "CDP command failed",
          ),
        );
        return;
      }
      pending.resolve(toJsonValue(payload.result ?? null));
    });
    socket.on("close", () => this.rejectAll("CDP connection closed"));
    socket.on("error", (error) => this.rejectAll(error.message));
  }

  static async connect(url: string): Promise<WebSocketCdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(
          new Error("Timed out connecting to the embedded Browser target"),
        );
      }, CDP_TIMEOUT_MS);
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve(new WebSocketCdpClient(socket));
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  close(): void {
    this.socket.close();
  }

  send(
    method: string,
    params: Record<string, JsonValue> = {},
  ): Promise<JsonValue> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out`));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, { reject, resolve, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

const defaultRuntime: EmbeddedBrowserRuntime = {
  connectCdp: (url) => WebSocketCdpClient.connect(url),
  fetchJson: async (url) => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(CDP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`DevTools endpoint returned HTTP ${response.status}`);
    }
    return toJsonValue(await response.json());
  },
  now: () => Date.now(),
  randomId: () => randomUUID(),
  readFile: (filePath) => fs.readFile(filePath, "utf8"),
};

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toJsonValue(child)]),
    );
  }
  return String(value);
}

function requireString(
  args: Readonly<Record<string, JsonValue>>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_invalid_arguments",
      `${key} must be a non-empty string`,
    );
  }
  return value;
}

function requireInteger(
  args: Readonly<Record<string, JsonValue>>,
  key: string,
): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_invalid_arguments",
      `${key} must be an integer`,
    );
  }
  return value;
}

function optionalString(
  args: Readonly<Record<string, JsonValue>>,
  key: string,
): string | null {
  const value = args[key];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_invalid_arguments",
      `${key} must be a non-empty string when provided`,
    );
  }
  return value;
}

function parseIdentity(
  raw: string,
  expectedUserDataDir: string,
): EmbeddedBrowserIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_embedded_browser_unavailable",
      "Jack's IDE Computer Use identity is invalid; restart the managed desktop session.",
    );
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.appUrl !== "string" ||
    typeof parsed.instanceId !== "string" ||
    typeof parsed.pid !== "number" ||
    !Number.isInteger(parsed.pid) ||
    typeof parsed.startedAtMs !== "number" ||
    typeof parsed.userDataDir !== "string" ||
    path.resolve(parsed.userDataDir) !== path.resolve(expectedUserDataDir)
  ) {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_embedded_browser_unavailable",
      "Jack's IDE Computer Use identity does not match this host data directory.",
    );
  }
  let appUrl: URL;
  try {
    appUrl = new URL(parsed.appUrl);
  } catch {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_embedded_browser_unavailable",
      "Jack's IDE Computer Use app URL is invalid.",
    );
  }
  if (
    (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") ||
    (appUrl.hostname !== "localhost" && appUrl.hostname !== "127.0.0.1")
  ) {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_embedded_browser_unavailable",
      "Jack's IDE Computer Use app URL must be loopback HTTP(S).",
    );
  }
  return {
    appUrl: appUrl.origin,
    instanceId: parsed.instanceId,
    pid: parsed.pid,
    startedAtMs: parsed.startedAtMs,
    userDataDir: parsed.userDataDir,
  };
}

function parseEndpoint(raw: string): DevToolsEndpoint {
  const [portLine, browserPath] = raw.trim().split(/\r?\n/u);
  const port = Number(portLine);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    browserPath === undefined ||
    !browserPath.startsWith("/devtools/browser/")
  ) {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_embedded_browser_unavailable",
      "Jack's IDE DevTools endpoint is unavailable; restart the managed desktop session.",
    );
  }
  return { port };
}

function parseTargets(value: JsonValue): DevToolsTarget[] {
  if (!Array.isArray(value)) {
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_embedded_browser_unavailable",
      "Jack's IDE DevTools target list was not an array.",
    );
  }
  return value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.type !== "string" ||
      typeof candidate.url !== "string" ||
      typeof candidate.webSocketDebuggerUrl !== "string"
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        title: candidate.title,
        type: candidate.type,
        url: candidate.url,
        webSocketDebuggerUrl: candidate.webSocketDebuggerUrl,
      },
    ];
  });
}

function routeFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function stringValue(value: AxValue | undefined): string {
  if (
    value === undefined ||
    value.value === undefined ||
    value.value === null
  ) {
    return "";
  }
  return typeof value.value === "string" ? value.value : String(value.value);
}

function booleanProperty(
  properties: AxProperty[] | undefined,
  name: string,
): boolean | null {
  const property = properties?.find((candidate) => candidate.name === name);
  return typeof property?.value?.value === "boolean"
    ? property.value.value
    : null;
}

function parseAxNodes(value: JsonValue): AxNode[] {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return [];
  return value.nodes.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    return [candidate as AxNode];
  });
}

function parseBox(value: JsonValue): NodeBox | null {
  if (!isRecord(value) || !isRecord(value.model)) return null;
  const quad = value.model.border;
  if (
    !Array.isArray(quad) ||
    quad.length < 8 ||
    !quad.every((coordinate) => typeof coordinate === "number")
  ) {
    return null;
  }
  const numbers = quad as number[];
  const xs = [numbers[0], numbers[2], numbers[4], numbers[6]] as number[];
  const ys = [numbers[1], numbers[3], numbers[5], numbers[7]] as number[];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { height, width, x, y } : null;
}

async function readPageIdentity(client: CdpClient): Promise<{
  title: string;
  url: string;
}> {
  const identity = await evaluateSerializedJson(
    client,
    "JSON.stringify({url: location.href, title: document.title})",
  );
  if (
    !isRecord(identity) ||
    typeof identity.title !== "string" ||
    typeof identity.url !== "string"
  ) {
    throw new Error("CDP page identity was incomplete");
  }
  return { title: identity.title, url: identity.url };
}

async function evaluateSerializedJson(
  client: CdpClient,
  expression: string,
  awaitPromise = false,
): Promise<JsonValue> {
  const result = await client.send("Runtime.evaluate", {
    awaitPromise,
    expression,
    returnByValue: true,
  });
  if (!isRecord(result) || !isRecord(result.result)) {
    throw new Error("CDP Runtime.evaluate returned no result");
  }
  const encoded = result.result.value;
  if (typeof encoded !== "string") {
    throw new Error("CDP Runtime.evaluate did not return serialized JSON");
  }
  return JSON.parse(encoded) as JsonValue;
}

interface DesktopBrowserTargetIdentity {
  cdpTargetId: string;
  desktopTabId: string;
}

async function resolveDesktopBrowserTargetIdentity(
  runtime: EmbeddedBrowserRuntime,
  hostTarget: DevToolsTarget,
  expectedUrl: string,
): Promise<DesktopBrowserTargetIdentity> {
  const client = await runtime.connectCdp(hostTarget.webSocketDebuggerUrl);
  try {
    const resolved = await evaluateSerializedJson(
      client,
      `(async () => { const matches = Array.from(document.querySelectorAll('[data-app-browser][data-bb-browser-tab-id]')).filter((element) => element.getAttribute('data-bb-browser-native-visible') === 'true' && element.getAttribute('data-bb-browser-url') === ${JSON.stringify(expectedUrl)}); if (matches.length !== 1) return JSON.stringify({ matches: matches.length }); const tabId = matches[0]?.getAttribute('data-bb-browser-tab-id'); const identify = window.bbDesktop?.browser?.identifyForComputerUse; if (typeof identify !== 'function') return JSON.stringify({ error: 'This Jack\\'s IDE desktop shell does not support exact-tab identity.' }); try { return JSON.stringify({ result: await identify(tabId) }); } catch (error) { return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }); } })()`,
      true,
    );
    if (
      !isRecord(resolved) ||
      !isRecord(resolved.result) ||
      typeof resolved.result.cdpTargetId !== "string" ||
      resolved.result.cdpTargetId.length === 0 ||
      typeof resolved.result.tabId !== "string" ||
      resolved.result.tabId.length === 0 ||
      resolved.result.url !== expectedUrl
    ) {
      const detail =
        isRecord(resolved) && typeof resolved.error === "string"
          ? ` ${resolved.error}`
          : isRecord(resolved) && typeof resolved.matches === "number"
            ? ` Found ${resolved.matches} visible matches.`
            : "";
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_wrong_target",
        `Could not resolve one exact visible Jack's IDE Browser tab at ${JSON.stringify(expectedUrl)}.${detail}`,
      );
    }
    return {
      cdpTargetId: resolved.result.cdpTargetId,
      desktopTabId: resolved.result.tabId,
    };
  } finally {
    client.close();
  }
}

interface DesktopBrowserCapture {
  capturedAtMs: number;
  dataUrl: string;
  tabId: string;
  url: string;
}

function parseDesktopBrowserCapture(value: JsonValue): DesktopBrowserCapture {
  if (!isRecord(value) || !isRecord(value.result)) {
    const detail =
      isRecord(value) && typeof value.error === "string"
        ? `: ${value.error}`
        : "";
    throw new EmbeddedBrowserComputerUseError(
      "computer_use_embedded_browser_unavailable",
      `Jack's IDE could not capture the embedded Browser tab${detail}`,
    );
  }
  const result = value.result;
  if (
    typeof result.capturedAtMs !== "number" ||
    !Number.isInteger(result.capturedAtMs) ||
    typeof result.dataUrl !== "string" ||
    typeof result.tabId !== "string" ||
    typeof result.url !== "string"
  ) {
    throw new Error("Jack's IDE returned an invalid embedded Browser capture");
  }
  return {
    capturedAtMs: result.capturedAtMs,
    dataUrl: result.dataUrl,
    tabId: result.tabId,
    url: result.url,
  };
}

async function captureDesktopBrowserTab(
  runtime: EmbeddedBrowserRuntime,
  binding: EmbeddedBinding,
): Promise<DesktopBrowserCapture> {
  const client = await runtime.connectCdp(binding.hostWebSocketDebuggerUrl);
  try {
    const result = await evaluateSerializedJson(
      client,
      `(async () => { const capture = window.bbDesktop?.browser?.capture; if (typeof capture !== 'function') return JSON.stringify({ error: 'This Jack\\'s IDE desktop shell does not support exact-tab capture.' }); try { return JSON.stringify({ result: await capture(${JSON.stringify(binding.desktopTabId)}) }); } catch (error) { return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }); } })()`,
      true,
    );
    return parseDesktopBrowserCapture(result);
  } finally {
    client.close();
  }
}

async function boxForBackendNode(
  client: CdpClient,
  backendNodeId: number,
): Promise<NodeBox | null> {
  try {
    return parseBox(await client.send("DOM.getBoxModel", { backendNodeId }));
  } catch {
    return null;
  }
}

function pointForBox(box: NodeBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function isEmbeddedTargetId(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.startsWith(EMBEDDED_TARGET_PREFIX);
}

function shouldHandleEmbedded(
  tool: ComputerUseToolName,
  args: Readonly<Record<string, JsonValue>>,
): boolean {
  if (tool === "get_browser_state" && args.embedded === true) return true;
  return isEmbeddedTargetId(args.target_id);
}

export function createEmbeddedBrowserComputerUseBridge(
  runtime: EmbeddedBrowserRuntime = defaultRuntime,
) {
  const bindings = new Map<string, EmbeddedBinding>();

  async function readDiscovery(dataDir: string): Promise<{
    endpoint: DevToolsEndpoint;
    identity: EmbeddedBrowserIdentity;
    targets: DevToolsTarget[];
  }> {
    const userDataDir = path.join(dataDir, "desktop");
    let identityRaw: string;
    let endpointRaw: string;
    try {
      [identityRaw, endpointRaw] = await Promise.all([
        runtime.readFile(path.join(userDataDir, COMPUTER_USE_IDENTITY_FILE)),
        runtime.readFile(path.join(userDataDir, DEVTOOLS_ACTIVE_PORT_FILE)),
      ]);
    } catch {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_unavailable",
        "Jack's IDE embedded Browser bridge is not running for this host data directory.",
      );
    }
    const identity = parseIdentity(identityRaw, userDataDir);
    if (identity.instanceId !== path.basename(dataDir)) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_wrong_instance",
        "Jack's IDE instance identity does not match this host data directory.",
      );
    }
    const endpoint = parseEndpoint(endpointRaw);
    const targets = parseTargets(
      await runtime.fetchJson(`http://127.0.0.1:${endpoint.port}/json/list`),
    );
    for (const target of targets) {
      let debuggerUrl: URL;
      try {
        debuggerUrl = new URL(target.webSocketDebuggerUrl);
      } catch {
        throw new EmbeddedBrowserComputerUseError(
          "computer_use_embedded_browser_unavailable",
          "Jack's IDE returned an invalid DevTools target URL.",
        );
      }
      if (
        debuggerUrl.protocol !== "ws:" ||
        debuggerUrl.hostname !== "127.0.0.1" ||
        Number(debuggerUrl.port) !== endpoint.port
      ) {
        throw new EmbeddedBrowserComputerUseError(
          "computer_use_embedded_browser_unavailable",
          "Jack's IDE returned a non-loopback or mismatched DevTools target.",
        );
      }
    }
    return { endpoint, identity, targets };
  }

  function bindingFor(
    args: Readonly<Record<string, JsonValue>>,
  ): EmbeddedBinding {
    const targetId = requireString(args, "target_id");
    const binding = bindings.get(targetId);
    if (binding === undefined) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_target",
        "The embedded Browser target is missing or stale; bind it again from a fresh canonical window inspection.",
      );
    }
    if (
      requireString(args, "tab_id") !== binding.tabId ||
      requireString(args, "session") !== binding.session
    ) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_target",
        "The embedded Browser target, tab, and session do not belong to the same binding.",
      );
    }
    return binding;
  }

  async function assertBindingCurrent(binding: EmbeddedBinding): Promise<void> {
    const discovery = await readDiscovery(binding.dataDir);
    if (
      discovery.identity.pid !== binding.native.pid ||
      discovery.identity.instanceId !== binding.instanceId
    ) {
      bindings.delete(binding.targetId);
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_target",
        "Jack's IDE restarted after this embedded Browser binding; inspect and bind again.",
      );
    }
    const current = discovery.targets.find(
      (target) => target.id === binding.cdpTargetId,
    );
    const currentProjectTargets = discovery.targets.filter((target) => {
      if (
        target.type !== "page" ||
        routeFromUrl(target.url) !== binding.projectRoute
      ) {
        return false;
      }
      try {
        return new URL(target.url).origin === binding.appUrl;
      } catch {
        return false;
      }
    });
    if (
      current === undefined ||
      current.webSocketDebuggerUrl !== binding.webSocketDebuggerUrl ||
      currentProjectTargets.length !== 1 ||
      currentProjectTargets[0]?.id !== binding.hostCdpTargetId ||
      currentProjectTargets[0]?.webSocketDebuggerUrl !==
        binding.hostWebSocketDebuggerUrl
    ) {
      bindings.delete(binding.targetId);
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_target",
        "The embedded Browser tab or Jack's IDE project route changed after this binding; inspect and bind again.",
      );
    }
  }

  async function bind(args: HandleEmbeddedBrowserCallArgs): Promise<JsonValue> {
    const pid = requireInteger(args.arguments, "pid");
    const windowId = requireInteger(args.arguments, "window_id");
    const session = requireString(args.arguments, "session");
    const expectedUrl = requireString(args.arguments, "expected_url");
    let parsedExpectedUrl: URL;
    try {
      parsedExpectedUrl = new URL(expectedUrl);
    } catch {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_invalid_arguments",
        "expected_url must be a valid URL.",
      );
    }
    if (
      parsedExpectedUrl.protocol !== "http:" &&
      parsedExpectedUrl.protocol !== "https:"
    ) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_invalid_arguments",
        "expected_url must use http or https.",
      );
    }
    const expectedProjectRoute = optionalString(
      args.arguments,
      "expected_project_route",
    );
    const discovery = await readDiscovery(args.dataDir);
    if (discovery.identity.pid !== pid) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_wrong_instance",
        `The requested pid ${pid} is not Jack's IDE pid ${discovery.identity.pid} for instance ${discovery.identity.instanceId}.`,
      );
    }
    const native = await args.inspectNativeWindow({
      instanceId: discovery.identity.instanceId,
      pid,
      windowId,
    });
    const hostTargets = discovery.targets.filter((target) => {
      if (target.type !== "page") return false;
      try {
        return new URL(target.url).origin === discovery.identity.appUrl;
      } catch {
        return false;
      }
    });
    const projectTargets =
      expectedProjectRoute === null
        ? hostTargets
        : hostTargets.filter(
            (target) => routeFromUrl(target.url) === expectedProjectRoute,
          );
    if (projectTargets.length !== 1) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_wrong_target",
        `Expected exactly one Jack's IDE renderer target${
          expectedProjectRoute === null ? "" : ` at ${expectedProjectRoute}`
        }; found ${projectTargets.length}.`,
      );
    }
    const targetId = `${EMBEDDED_TARGET_PREFIX}${runtime.randomId()}`;
    const tabId = `${EMBEDDED_TAB_PREFIX}${runtime.randomId()}`;
    const hostTarget = projectTargets[0];
    if (hostTarget === undefined) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_wrong_target",
        "The Jack's IDE renderer target disappeared during binding.",
      );
    }
    const resolvedBrowserTarget = await resolveDesktopBrowserTargetIdentity(
      runtime,
      hostTarget,
      expectedUrl,
    );
    const pageTarget = discovery.targets.find(
      (target) =>
        target.type === "page" &&
        target.url === expectedUrl &&
        target.id === resolvedBrowserTarget.cdpTargetId,
    );
    if (pageTarget === undefined) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_wrong_target",
        "The exact visible Browser tab did not match a live DevTools page target.",
      );
    }
    const binding: EmbeddedBinding = {
      appUrl: discovery.identity.appUrl,
      cdpTargetId: pageTarget.id,
      dataDir: args.dataDir,
      desktopTabId: resolvedBrowserTarget.desktopTabId,
      expectedUrl,
      hostCdpTargetId: hostTarget.id,
      hostWebSocketDebuggerUrl: hostTarget.webSocketDebuggerUrl,
      instanceId: discovery.identity.instanceId,
      native,
      projectRoute: routeFromUrl(projectTargets[0]?.url ?? ""),
      refs: new Map(),
      session,
      snapshotSequence: 0,
      tabId,
      targetId,
      webSocketDebuggerUrl: pageTarget.webSocketDebuggerUrl,
    };
    bindings.set(targetId, binding);
    const boundAtMs = runtime.now();
    return {
      binding: "bb_embedded_browser_v1",
      bound_at: new Date(boundAtMs).toISOString(),
      bound_at_ms: boundAtMs,
      instance_id: binding.instanceId,
      page_title: pageTarget.title,
      page_url: pageTarget.url,
      pid: native.pid,
      project_route: binding.projectRoute,
      tab_id: tabId,
      target_id: targetId,
      window_id: native.windowId,
      window_title: native.title,
    };
  }

  async function snapshot(
    binding: EmbeddedBinding,
    args: Readonly<Record<string, JsonValue>>,
  ): Promise<EmbeddedSnapshot> {
    await assertBindingCurrent(binding);
    const expectedUrl =
      optionalString(args, "expected_url") ?? binding.expectedUrl;
    const expectedProjectRoute =
      optionalString(args, "expected_project_route") ?? binding.projectRoute;
    if (expectedProjectRoute !== binding.projectRoute) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_frame",
        `The binding belongs to project route ${binding.projectRoute}, not ${expectedProjectRoute}.`,
      );
    }
    const client = await runtime.connectCdp(binding.webSocketDebuggerUrl);
    try {
      await Promise.all([
        client.send("Accessibility.enable"),
        client.send("DOM.enable"),
        client.send("Page.enable"),
      ]);
      const before = await readPageIdentity(client);
      if (before.url !== expectedUrl) {
        throw new EmbeddedBrowserComputerUseError(
          "computer_use_embedded_browser_stale_frame",
          `Expected embedded page ${expectedUrl}, but the live tab is ${before.url}.`,
        );
      }
      const axResult = await client.send("Accessibility.getFullAXTree");
      const candidates = parseAxNodes(axResult)
        .filter((node) => {
          if (node.ignored || node.backendDOMNodeId === undefined) return false;
          const role = stringValue(node.role).toLowerCase();
          return (
            INTERACTIVE_ROLES.has(role) ||
            stringValue(node.name).trim().length > 0 ||
            stringValue(node.value).trim().length > 0
          );
        })
        .slice(0, MAX_AX_ELEMENTS);
      binding.snapshotSequence += 1;
      binding.refs.clear();
      const snapshotId = `bbp${binding.snapshotSequence.toString(16).padStart(8, "0")}`;
      const query = optionalString(args, "query")?.toLowerCase() ?? null;
      const observedCandidates = await Promise.all(
        candidates.map(async (candidate) => {
          const backendNodeId = candidate.backendDOMNodeId;
          if (backendNodeId === undefined) return null;
          const role = stringValue(candidate.role) || "unknown";
          const label = stringValue(candidate.name);
          const value = stringValue(candidate.value);
          const description = stringValue(candidate.description);
          const searchable =
            `${role} ${label} ${value} ${description}`.toLowerCase();
          if (query !== null && !searchable.includes(query)) return null;
          const bounds = await boxForBackendNode(client, backendNodeId);
          if (bounds === null && INTERACTIVE_ROLES.has(role.toLowerCase())) {
            return null;
          }
          return {
            backendNodeId,
            bounds,
            candidate,
            description,
            label,
            role,
            value,
          };
        }),
      );
      const elements: EmbeddedSnapshotElement[] = [];
      for (const observed of observedCandidates) {
        if (observed === null) continue;
        const {
          backendNodeId,
          bounds,
          candidate,
          description,
          label,
          role,
          value,
        } = observed;
        const ref = `${snapshotId}:${elements.length}`;
        binding.refs.set(ref, backendNodeId);
        elements.push({
          bounds,
          description: description.length > 0 ? description : null,
          enabled:
            booleanProperty(candidate.properties, "disabled") === null
              ? null
              : !booleanProperty(candidate.properties, "disabled"),
          focused: booleanProperty(candidate.properties, "focused"),
          label,
          ref,
          role,
          selected: booleanProperty(candidate.properties, "selected"),
          value: value.length > 0 ? value : null,
        });
      }
      const includeScreenshot = args.include_screenshot !== false;
      let screenshot: string | undefined;
      if (includeScreenshot) {
        const captured = await captureDesktopBrowserTab(runtime, binding);
        if (
          captured.tabId !== binding.desktopTabId ||
          captured.url !== before.url
        ) {
          throw new EmbeddedBrowserComputerUseError(
            "computer_use_embedded_browser_stale_frame",
            "The captured native Browser tab no longer matches this bound page.",
          );
        }
        if (captured.dataUrl.length > MAX_SCREENSHOT_BASE64_LENGTH) {
          throw new EmbeddedBrowserComputerUseError(
            "computer_use_output_too_large",
            "The embedded Browser screenshot exceeded the bounded output limit.",
          );
        }
        screenshot = captured.dataUrl;
      }
      await assertBindingCurrent(binding);
      const after = await readPageIdentity(client);
      if (after.url !== before.url || after.title !== before.title) {
        binding.refs.clear();
        throw new EmbeddedBrowserComputerUseError(
          "computer_use_embedded_browser_stale_frame",
          "The embedded page changed while it was being captured; inspect it again.",
        );
      }
      const capturedAtMs = runtime.now();
      const notBefore = args.not_before_ms;
      if (typeof notBefore === "number" && capturedAtMs < notBefore) {
        throw new EmbeddedBrowserComputerUseError(
          "computer_use_embedded_browser_stale_frame",
          `The capture timestamp ${capturedAtMs} predates the required ${notBefore}.`,
        );
      }
      return {
        captured_at: new Date(capturedAtMs).toISOString(),
        captured_at_ms: capturedAtMs,
        elements,
        outline: elements
          .map(
            (element) =>
              `${element.ref} ${element.role} ${JSON.stringify(element.label)}${
                element.value === null
                  ? ""
                  : ` value=${JSON.stringify(element.value)}`
              }`,
          )
          .join("\n"),
        page_title: after.title,
        page_url: after.url,
        project_route: binding.projectRoute,
        ...(screenshot === undefined ? {} : { screenshot }),
        snapshot_format: "semantic_v2",
        snapshot_id: snapshotId,
        tab_id: binding.tabId,
        target_id: binding.targetId,
      };
    } finally {
      client.close();
    }
  }

  async function pointForRef(
    binding: EmbeddedBinding,
    client: CdpClient,
    ref: string,
  ): Promise<{ backendNodeId: number; x: number; y: number }> {
    const backendNodeId = binding.refs.get(ref);
    if (backendNodeId === undefined) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_ref",
        "The embedded Browser ref is stale; inspect the page again and use a ref from the latest snapshot.",
      );
    }
    await client.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const box = await boxForBackendNode(client, backendNodeId);
    if (box === null) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_ref",
        "The embedded Browser element no longer has a visible layout box; inspect again.",
      );
    }
    return { backendNodeId, ...pointForBox(box) };
  }

  async function act(
    tool: ComputerUseToolName,
    binding: EmbeddedBinding,
    args: Readonly<Record<string, JsonValue>>,
  ): Promise<JsonValue> {
    await assertBindingCurrent(binding);
    const expectedProjectRoute =
      optionalString(args, "expected_project_route") ?? binding.projectRoute;
    if (expectedProjectRoute !== binding.projectRoute) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_embedded_browser_stale_frame",
        `The binding belongs to project route ${binding.projectRoute}, not ${expectedProjectRoute}.`,
      );
    }
    const client = await runtime.connectCdp(binding.webSocketDebuggerUrl);
    try {
      const before = await readPageIdentity(client);
      const expectedUrl =
        optionalString(args, "expected_url") ?? binding.expectedUrl;
      if (before.url !== expectedUrl) {
        throw new EmbeddedBrowserComputerUseError(
          "computer_use_embedded_browser_stale_frame",
          `Expected embedded page ${expectedUrl}, but the live tab is ${before.url}.`,
        );
      }
      if (tool === "browser_navigate") {
        const url = requireString(args, "url");
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new EmbeddedBrowserComputerUseError(
            "computer_use_invalid_arguments",
            "Embedded Browser navigation only allows http(s) URLs.",
          );
        }
        await client.send("Page.navigate", { url: parsed.toString() });
        binding.expectedUrl = parsed.toString();
      } else if (tool === "browser_click") {
        const ref = requireString(args, "ref");
        const point = await pointForRef(binding, client, ref);
        await client.send("Input.dispatchMouseEvent", {
          button: "left",
          clickCount: 1,
          type: "mousePressed",
          x: point.x,
          y: point.y,
        });
        await client.send("Input.dispatchMouseEvent", {
          button: "left",
          clickCount: 1,
          type: "mouseReleased",
          x: point.x,
          y: point.y,
        });
      } else if (tool === "browser_type") {
        const ref = requireString(args, "ref");
        const text = requireString(args, "text");
        const point = await pointForRef(binding, client, ref);
        await client.send("DOM.focus", { backendNodeId: point.backendNodeId });
        await client.send("Input.insertText", { text });
      } else if (tool === "browser_pointer") {
        const operation = requireString(args, "operation");
        const ref = requireString(args, "ref");
        const point = await pointForRef(binding, client, ref);
        if (operation === "hover") {
          await client.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: point.x,
            y: point.y,
          });
        } else if (operation === "right_click") {
          await client.send("Input.dispatchMouseEvent", {
            button: "right",
            clickCount: 1,
            type: "mousePressed",
            x: point.x,
            y: point.y,
          });
          await client.send("Input.dispatchMouseEvent", {
            button: "right",
            clickCount: 1,
            type: "mouseReleased",
            x: point.x,
            y: point.y,
          });
        } else if (operation === "double_click") {
          for (let clickCount = 1; clickCount <= 2; clickCount += 1) {
            await client.send("Input.dispatchMouseEvent", {
              button: "left",
              clickCount,
              type: "mousePressed",
              x: point.x,
              y: point.y,
            });
            await client.send("Input.dispatchMouseEvent", {
              button: "left",
              clickCount,
              type: "mouseReleased",
              x: point.x,
              y: point.y,
            });
          }
        } else {
          throw new EmbeddedBrowserComputerUseError(
            "computer_use_invalid_arguments",
            "Embedded browser_pointer supports hover, right_click, and double_click.",
          );
        }
      } else {
        throw new EmbeddedBrowserComputerUseError(
          "computer_use_invalid_arguments",
          `${tool} is not an embedded Browser action.`,
        );
      }
      binding.refs.clear();
      const actedAtMs = runtime.now();
      return {
        acted_at: new Date(actedAtMs).toISOString(),
        acted_at_ms: actedAtMs,
        page_url_before_action: before.url,
        project_route: binding.projectRoute,
        tab_id: binding.tabId,
        target_id: binding.targetId,
      };
    } finally {
      client.close();
    }
  }

  function matchesElementSelector(
    element: EmbeddedSnapshotElement,
    selector: Readonly<Record<string, JsonValue>>,
  ): boolean {
    if (
      typeof selector.role === "string" &&
      element.role.toLowerCase() !== selector.role.toLowerCase()
    ) {
      return false;
    }
    if (
      typeof selector.label_contains === "string" &&
      !element.label
        .toLowerCase()
        .includes(selector.label_contains.toLowerCase())
    ) {
      return false;
    }
    return true;
  }

  async function verify(
    binding: EmbeddedBinding,
    args: Readonly<Record<string, JsonValue>>,
  ): Promise<JsonValue> {
    const observed = await snapshot(binding, {
      ...args,
      include_screenshot: false,
    });
    const expectations = args.expect;
    if (!Array.isArray(expectations) || expectations.length === 0) {
      throw new EmbeddedBrowserComputerUseError(
        "computer_use_invalid_arguments",
        "Embedded Browser verification requires a non-empty expect array.",
      );
    }
    const satisfied: JsonValue[] = [];
    const unsatisfied: JsonValue[] = [];
    const unknown: JsonValue[] = [];
    expectations.forEach((expectation, index) => {
      if (!isRecord(expectation) || !isRecord(expectation.element)) {
        unknown.push({ expectation, index, reason: "unsupported predicate" });
        return;
      }
      const selector = expectation.element.selector;
      if (!isRecord(selector)) {
        unknown.push({ expectation, index, reason: "missing selector" });
        return;
      }
      const matches = observed.elements.filter((element) =>
        matchesElementSelector(element, selector),
      );
      const expectedExists = expectation.element.exists;
      if (typeof expectedExists === "boolean") {
        const actual = matches.length > 0;
        (actual === expectedExists ? satisfied : unsatisfied).push({
          actual: { exists: actual, matches: matches.length },
          expectation,
          index,
        });
        return;
      }
      if (typeof expectation.element.value_equals === "string") {
        const actual =
          matches.length === 1 ? (matches[0]?.value ?? null) : null;
        (actual === expectation.element.value_equals
          ? satisfied
          : unsatisfied
        ).push({ actual: { value: actual }, expectation, index });
        return;
      }
      if (typeof expectation.element.enabled === "boolean") {
        const actual =
          matches.length === 1 ? (matches[0]?.enabled ?? null) : null;
        (actual === expectation.element.enabled ? satisfied : unsatisfied).push(
          {
            actual: { enabled: actual },
            expectation,
            index,
          },
        );
        return;
      }
      if (typeof expectation.element.selected === "boolean") {
        const actual =
          matches.length === 1 ? (matches[0]?.selected ?? null) : null;
        (actual === expectation.element.selected
          ? satisfied
          : unsatisfied
        ).push({ actual: { selected: actual }, expectation, index });
        return;
      }
      unknown.push({
        expectation,
        index,
        reason: "unsupported element assertion",
      });
    });
    return {
      captured_at: observed.captured_at,
      captured_at_ms: observed.captured_at_ms,
      page_url: observed.page_url,
      project_route: observed.project_route,
      satisfied,
      status:
        unsatisfied.length > 0
          ? "unsatisfied"
          : unknown.length > 0
            ? "unknown"
            : "satisfied",
      tab_id: binding.tabId,
      target_id: binding.targetId,
      unknown,
      unsatisfied,
    };
  }

  return {
    async handle(
      args: HandleEmbeddedBrowserCallArgs,
    ): Promise<JsonValue | null> {
      if (!shouldHandleEmbedded(args.tool, args.arguments)) return null;
      if (
        args.tool === "get_browser_state" &&
        args.arguments.embedded === true
      ) {
        return bind(args);
      }
      const binding = bindingFor(args.arguments);
      if (args.tool === "get_browser_state") {
        return toJsonValue(await snapshot(binding, args.arguments));
      }
      if (args.tool === "verify_state") {
        return verify(binding, args.arguments);
      }
      return act(args.tool, binding, args.arguments);
    },
    releaseSession(session: string): void {
      for (const [targetId, binding] of bindings.entries()) {
        if (binding.session === session) bindings.delete(targetId);
      }
    },
  };
}

export const embeddedBrowserComputerUseBridge =
  createEmbeddedBrowserComputerUseBridge();

export const embeddedBrowserComputerUseTestSupport = {
  COMPUTER_USE_IDENTITY_FILE,
  DEVTOOLS_ACTIVE_PORT_FILE,
  EMBEDDED_TAB_PREFIX,
  EMBEDDED_TARGET_PREFIX,
};
