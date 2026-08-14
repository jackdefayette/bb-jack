import {
  defineRpcContract,
  type BbPluginApi,
  type JsonValue,
  type PluginAgentToolResult,
  type PluginCliContext,
  type PluginCliResult,
  type PluginComputerUseResult,
  type PluginComputerUseToolName,
} from "@bb/plugin-sdk";
import { z } from "zod";

const TOOL_NAMES = [
  "check_permissions",
  "list_apps",
  "list_windows",
  "get_accessibility_tree",
  "get_window_state",
  "get_desktop_state",
  "get_screen_size",
  "get_cursor_position",
  "get_browser_state",
  "bring_to_front",
  "launch_app",
  "click",
  "double_click",
  "right_click",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "hotkey",
  "set_value",
  "invoke_menu",
  "verify_state",
  "start_session",
  "end_session",
  "browser_click",
  "browser_type",
  "browser_pointer",
  "browser_navigate",
] as const satisfies readonly PluginComputerUseToolName[];

const INSPECT_TOOLS = [
  "check_permissions",
  "list_apps",
  "list_windows",
  "get_accessibility_tree",
  "get_window_state",
  "get_desktop_state",
  "get_screen_size",
  "get_cursor_position",
  "get_browser_state",
] as const;

const ACTION_TOOLS = [
  "bring_to_front",
  "launch_app",
  "click",
  "double_click",
  "right_click",
  "scroll",
  "drag",
  "type_text",
  "press_key",
  "hotkey",
  "set_value",
  "invoke_menu",
  "start_session",
  "end_session",
  "browser_click",
  "browser_type",
  "browser_pointer",
  "browser_navigate",
] as const;

const NATIVE_STABLE_TARGET_TOOLS = new Set<PluginComputerUseToolName>([
  "click",
  "double_click",
  "right_click",
  "scroll",
  "type_text",
  "press_key",
  "set_value",
]);

const stableTargetSchema = z
  .object({
    pid: z.number().int().positive(),
    window_id: z.number().int(),
    label: z.string().min(1),
    role: z.string().min(1).optional(),
  })
  .strict();

const toolNameSchema = z.enum(TOOL_NAMES);
const jsonObjectSchema = z.record(z.string(), z.json());
const computerUseResultSchema = z
  .object({ tool: toolNameSchema, result: z.json() })
  .strict();
const statusHostSchema = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    connected: z.boolean(),
    permissions: z.json().nullable(),
    error: z.string().nullable(),
  })
  .strict();
const threadHostSchema = z.object({
  host: z
    .object({ id: z.string().min(1) })
    .nullable()
    .optional(),
});

export const computerUseRpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z.object({ hosts: z.array(statusHostSchema) }).strict(),
  },
  call: {
    input: z
      .object({
        hostId: z.string().min(1),
        tool: toolNameSchema,
        arguments: jsonObjectSchema,
      })
      .strict(),
    output: computerUseResultSchema,
  },
});

async function threadHostId(
  bb: BbPluginApi,
  threadId: string,
): Promise<string> {
  const thread = threadHostSchema.parse(
    await bb.sdk.threads.get({ threadId, include: "host" }),
  );
  if (!thread.host?.id) {
    throw new Error(`Thread ${threadId} does not have an execution host.`);
  }
  return thread.host.id;
}

async function selectedHostId(
  bb: BbPluginApi,
  explicitHostId: string | null,
  threadId: string | undefined,
): Promise<string> {
  if (explicitHostId) return explicitHostId;
  if (!threadId) {
    throw new Error(
      "Choose a host with --host, or run the command from a bb thread.",
    );
  }
  return threadHostId(bb, threadId);
}

async function callForThread(
  bb: BbPluginApi,
  threadId: string,
  tool: PluginComputerUseToolName,
  args: Readonly<Record<string, JsonValue>>,
): Promise<PluginComputerUseResult> {
  const hostId = await threadHostId(bb, threadId);
  return bb.hosts.experimental_callComputerUse(hostId, tool, args);
}

interface StableTarget {
  pid: number;
  window_id: number;
  label: string;
  role?: string;
}

interface DriverElement {
  element_token: string;
  label: string;
  role: string;
}

function driverElements(result: PluginComputerUseResult): DriverElement[] {
  if (!isRecord(result.result) || !Array.isArray(result.result.elements)) {
    throw new Error(
      "CUA Driver did not return structured accessibility elements for the fresh target snapshot.",
    );
  }
  return result.result.elements.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.element_token !== "string" ||
      typeof candidate.label !== "string" ||
      typeof candidate.role !== "string"
    ) {
      return [];
    }
    return [
      {
        element_token: candidate.element_token,
        label: candidate.label,
        role: candidate.role,
      },
    ];
  });
}

async function callWithFreshStableTarget(
  bb: BbPluginApi,
  threadId: string,
  tool: PluginComputerUseToolName,
  args: Readonly<Record<string, JsonValue>>,
  target: StableTarget,
): Promise<PluginComputerUseResult> {
  if (!NATIVE_STABLE_TARGET_TOOLS.has(tool)) {
    throw new Error(`${tool} does not support a native stable target.`);
  }
  for (const staleAddressKey of [
    "element_index",
    "element_token",
    "snapshot_id",
  ]) {
    if (staleAddressKey in args) {
      throw new Error(
        `Do not combine target with ${staleAddressKey}; the bridge resolves a fresh element token.`,
      );
    }
  }
  const snapshot = await callForThread(bb, threadId, "get_window_state", {
    pid: target.pid,
    window_id: target.window_id,
    query: target.label,
    include_screenshot: false,
  });
  const matches = driverElements(snapshot).filter(
    (element) =>
      element.label === target.label &&
      (target.role === undefined || element.role === target.role),
  );
  if (matches.length !== 1) {
    const roleSuffix =
      target.role === undefined ? "" : ` with role ${target.role}`;
    throw new Error(
      `Fresh stable target ${JSON.stringify(target.label)}${roleSuffix} matched ${matches.length} elements; expected exactly one. Inspect again with a more specific label and role.`,
    );
  }
  return callForThread(bb, threadId, tool, {
    ...args,
    pid: target.pid,
    window_id: target.window_id,
    element_token: matches[0]?.element_token ?? "",
  });
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ExtractedImage {
  data: string;
  mimeType: string;
}

function stripImageData(
  value: JsonValue,
  key: string | null,
  images: ExtractedImage[],
): JsonValue {
  if (typeof value === "string") {
    const imageKey = key !== null && /(?:screenshot|image)/iu.test(key);
    if (imageKey && value.length > 512) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/isu.exec(value);
      const data = match?.[2] ?? value;
      if (/^[a-z0-9+/=\r\n]+$/iu.test(data)) {
        images.push({
          data: data.replace(/\s+/gu, ""),
          mimeType: match?.[1] ?? "image/png",
        });
        return `[${key} forwarded as image content]`;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripImageData(item, key, images));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        stripImageData(child, childKey, images),
      ]),
    );
  }
  return value;
}

function agentToolResult(
  result: PluginComputerUseResult,
): PluginAgentToolResult {
  const images: ExtractedImage[] = [];
  const textResult = stripImageData(result.result, null, images);
  const serialized = JSON.stringify(
    { tool: result.tool, result: textResult },
    null,
    2,
  );
  const text =
    serialized.length <= 60_000
      ? serialized
      : `${serialized.slice(0, 60_000)}\n[structured result truncated]`;
  return {
    content: [
      { type: "text", text },
      ...images.slice(0, 1).map((image) => ({
        type: "image" as const,
        data: image.data,
        mimeType: image.mimeType,
      })),
    ],
  };
}

async function status(bb: BbPluginApi) {
  const hosts = await bb.sdk.hosts.list();
  return {
    hosts: await Promise.all(
      hosts.map(async (host) => {
        if (host.status !== "connected") {
          return {
            hostId: host.id,
            hostName: host.name,
            connected: false,
            permissions: null,
            error: null,
          };
        }
        try {
          const result = await bb.hosts.experimental_callComputerUse(
            host.id,
            "check_permissions",
            {},
          );
          return {
            hostId: host.id,
            hostName: host.name,
            connected: true,
            permissions: result.result,
            error: null,
          };
        } catch (error) {
          return {
            hostId: host.id,
            hostName: host.name,
            connected: true,
            permissions: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    ),
  };
}

interface ParsedCli {
  args: Record<string, JsonValue>;
  hostId: string | null;
  json: boolean;
  positional: string[];
}

function parseCli(argv: readonly string[]): ParsedCli {
  const positional: string[] = [];
  let hostId: string | null = null;
  let json = false;
  let args: Record<string, JsonValue> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--host" || token === "--args") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${token} requires a value.`);
      index += 1;
      if (token === "--host") hostId = value;
      else args = jsonObjectSchema.parse(JSON.parse(value));
      continue;
    }
    if (token.startsWith("--")) throw new Error(`Unknown option ${token}.`);
    positional.push(token);
  }
  return { args, hostId, json, positional };
}

const CLI_USAGE = [
  "Usage:",
  "  bb computer-use status [--json]",
  "  bb computer-use call <tool> [--args '<json>'] [--host <id>] [--json]",
  "",
  `Allowed tools: ${TOOL_NAMES.join(", ")}`,
].join("\n");

function printCli(value: unknown, json: boolean): string {
  return json ? JSON.stringify(value) : JSON.stringify(value, null, 2);
}

async function runCli(
  bb: BbPluginApi,
  argv: string[],
  ctx: PluginCliContext,
): Promise<PluginCliResult> {
  const parsed = parseCli(argv);
  const [command, rawTool] = parsed.positional;
  if (!command || command === "help" || command === "--help") {
    return { exitCode: 0, stdout: CLI_USAGE };
  }
  if (command === "status") {
    return { exitCode: 0, stdout: printCli(await status(bb), parsed.json) };
  }
  if (command !== "call" || !rawTool) throw new Error(CLI_USAGE);
  const tool = toolNameSchema.parse(rawTool);
  const hostId = await selectedHostId(bb, parsed.hostId, ctx.threadId);
  const result = await bb.hosts.experimental_callComputerUse(
    hostId,
    tool,
    parsed.args,
  );
  return { exitCode: 0, stdout: printCli(result, parsed.json) };
}

export default async function computerUsePlugin(bb: BbPluginApi) {
  bb.rpc.register(computerUseRpcContract, {
    status: () => status(bb),
    call: (input) =>
      bb.hosts.experimental_callComputerUse(
        input.hostId,
        input.tool,
        input.arguments,
      ),
  });

  bb.cli.register({
    name: "computer-use",
    summary: "Inspect and operate a host through the bounded CUA Driver bridge",
    commands: [
      {
        name: "status",
        summary: "Show connected hosts and CUA permission state",
        usage: "bb computer-use status [--json]",
      },
      {
        name: "call",
        summary: "Call one allowlisted CUA tool",
        usage:
          "bb computer-use call <tool> [--args '<json>'] [--host <id>] [--json]",
      },
    ],
    run: (argv, ctx) => runCli(bb, argv, ctx),
  });

  bb.agents.registerTool({
    name: "computer_use_inspect",
    description:
      "Inspect desktop UI or an exact embedded Browser tab. Native list/check tools use {}; get_window_state requires {pid,window_id}. get_browser_state binds with {pid,window_id,session} or snapshots with {target_id,tab_id,session,snapshot_format:'semantic_v2'}. Resolve native identity from fresh list results.",
    instructions:
      "Inspect fresh state before acting. Use fresh list_windows results to confirm the intended titled window is on_current_space and is_on_screen. If it is not, bring it to front and list windows again before inspecting it; treat a partial or unverified fronting result as a limitation. Call get_window_state again before every element-indexed action; never reuse stale element indices, snapshot ids, or tokens.",
    experimental_statusLabels: {
      pending: "Inspecting desktop",
      completed: "Inspected desktop",
    },
    parameters: z
      .object({ tool: z.enum(INSPECT_TOOLS), arguments: jsonObjectSchema })
      .strict(),
    execute: async ({ tool, arguments: args }, ctx) =>
      agentToolResult(await callForThread(bb, ctx.threadId, tool, args)),
  });

  bb.agents.registerTool({
    name: "computer_use_act",
    description:
      "Perform one bounded native or exact-tab action. First start_session with {session:<non-empty id>,capture_scope:'window'}; reuse session and end_session with {session}. Native element actions may pass target:{pid,window_id,label,role?}; the bridge explicitly re-snapshots and requires one exact match before using its fresh token. Browser actions use target_id/tab_id/session and fresh page refs from get_browser_state.",
    instructions:
      "Never call start_session with {}. Prefer accessibility element tokens over coordinates. Before acting, confirm the intended titled window is on the current Space; after bring_to_front, re-list windows and do not infer exact focus from a partial result. After every action, inspect fresh state before deciding the next action. No clipboard read, force-kill, unrestricted filesystem, or existing browser profile access is available.",
    experimental_statusLabels: {
      pending: "Using desktop",
      completed: "Used desktop",
    },
    parameters: z
      .object({
        tool: z.enum(ACTION_TOOLS),
        arguments: jsonObjectSchema,
        target: stableTargetSchema.optional(),
      })
      .strict(),
    execute: async ({ tool, arguments: args, target }, ctx) =>
      agentToolResult(
        target === undefined
          ? await callForThread(bb, ctx.threadId, tool, args)
          : await callWithFreshStableTarget(
              bb,
              ctx.threadId,
              tool,
              args,
              target,
            ),
      ),
  });

  bb.agents.registerTool({
    name: "computer_use_verify",
    description:
      "Verify one to eight predicates. arguments requires {pid,window_id,expect:[...]}; each expectation may assert window.exists/bounds or element.selector with exists:true, enabled, selected, or value_equals. Include session when one is active.",
    instructions:
      "Treat unknown as unverified, never as success. Report the exact satisfied, unsatisfied, and unknown predicates.",
    experimental_statusLabels: {
      pending: "Verifying desktop",
      completed: "Verified desktop",
    },
    parameters: z.object({ arguments: jsonObjectSchema }).strict(),
    execute: async ({ arguments: args }, ctx) =>
      agentToolResult(
        await callForThread(bb, ctx.threadId, "verify_state", args),
      ),
  });

  bb.agents.configure(() => ({
    tools: ["computer_use_inspect", "computer_use_act", "computer_use_verify"],
    skills: ["computer-use"],
    instructions:
      "Computer Use is a bounded, provider-independent CUA Driver bridge. Use its inspect-act-inspect-verify loop only when the user asks to operate desktop UI. Always start with a non-empty stable session id and reuse it through end_session. Electron WebContentsView Browser pages are a separate native/compositor and accessibility boundary: attempt an exact get_browser_state bind, then use browser_* actions only with returned target/tab ids and fresh page refs. If CUA Driver refuses a multi-target bind, use the Browser chrome's Open page in external browser for Computer Use affordance only when that launch is in scope; otherwise report the limit. Never claim the host window AX tree is exhaustive for embedded Browser contents.",
  }));
}
