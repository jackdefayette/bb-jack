import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { JsonValue } from "@bb/domain";
import {
  ExpectedCommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  EmbeddedBrowserComputerUseError,
  embeddedBrowserComputerUseBridge,
} from "./embedded-browser-computer-use.js";

const CUA_DRIVER_TIMEOUT_MS = 30_000;
const CUA_DRIVER_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MACOS_CUA_DRIVER_PATH =
  "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

interface RunCuaDriverArgs {
  executable: string;
  args: readonly string[];
  maxOutputBytes: number;
  timeoutMs: number;
}

interface RunCuaDriverResult {
  stdout: string;
  stderr: string;
}

interface ComputerUseRuntime {
  accessExecutable(path: string): Promise<void>;
  homeDir: string;
  platform: NodeJS.Platform;
  run(args: RunCuaDriverArgs): Promise<RunCuaDriverResult>;
}

class CuaDriverProcessError extends Error {
  constructor(
    readonly kind: "failed" | "output_too_large" | "timeout",
    message: string,
  ) {
    super(message);
    this.name = "CuaDriverProcessError";
  }
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  state: { totalBytes: number },
  maxOutputBytes: number,
): void {
  state.totalBytes += chunk.byteLength;
  if (state.totalBytes > maxOutputBytes) {
    throw new CuaDriverProcessError(
      "output_too_large",
      `CUA Driver output exceeded ${maxOutputBytes} bytes`,
    );
  }
  chunks.push(chunk);
}

async function runCuaDriver(
  args: RunCuaDriverArgs,
): Promise<RunCuaDriverResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.executable, [...args.args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const state = { totalBytes: 0 };
    let settled = false;

    const settleError = (error: Error): void => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(error);
    };

    const timeout = setTimeout(() => {
      settleError(
        new CuaDriverProcessError(
          "timeout",
          `CUA Driver timed out after ${args.timeoutMs}ms`,
        ),
      );
    }, args.timeoutMs);
    timeout.unref();

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      try {
        appendBounded(target, chunk, state, args.maxOutputBytes);
      } catch (error) {
        settleError(error instanceof Error ? error : new Error(String(error)));
      }
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", settleError);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(
          new CuaDriverProcessError(
            "failed",
            stderrText.trim() ||
              `CUA Driver exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
          ),
        );
        return;
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
  });
}

const defaultRuntime: ComputerUseRuntime = {
  accessExecutable: async (candidate) =>
    fs.access(candidate, fs.constants.X_OK),
  homeDir: os.homedir(),
  platform: process.platform,
  run: runCuaDriver,
};

async function resolveCuaDriverExecutable(
  runtime: Pick<
    ComputerUseRuntime,
    "accessExecutable" | "homeDir" | "platform"
  >,
): Promise<string | null> {
  const absoluteCandidates = [
    ...(runtime.platform === "darwin" ? [MACOS_CUA_DRIVER_PATH] : []),
    path.join(runtime.homeDir, ".local", "bin", "cua-driver"),
  ];
  for (const candidate of absoluteCandidates) {
    try {
      await runtime.accessExecutable(candidate);
      return candidate;
    } catch {
      // Try the next trusted install location.
    }
  }
  return null;
}

function mapCuaDriverError(error: unknown): never {
  if (error instanceof CuaDriverProcessError) {
    const code =
      error.kind === "timeout"
        ? "computer_use_timeout"
        : error.kind === "output_too_large"
          ? "computer_use_output_too_large"
          : "computer_use_driver_failed";
    throw new ExpectedCommandDispatchError(code, error.message);
  }
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    throw new ExpectedCommandDispatchError(
      "computer_use_driver_not_found",
      "CUA Driver is not installed. Install it from https://cua.ai/driver.",
    );
  }
  throw error;
}

function parseCuaDriverJson(stdout: string): JsonValue {
  try {
    return JSON.parse(stdout) as JsonValue;
  } catch {
    const driverMessage = stdout.trim();
    throw new ExpectedCommandDispatchError(
      driverMessage
        ? "computer_use_driver_failed"
        : "computer_use_invalid_response",
      driverMessage || "CUA Driver returned an empty non-JSON response.",
    );
  }
}

async function invokeCuaDriver(args: {
  arguments: Readonly<Record<string, JsonValue>>;
  executable: string;
  runtime: ComputerUseRuntime;
  tool: string;
}): Promise<JsonValue> {
  let stdout: string;
  try {
    ({ stdout } = await args.runtime.run({
      executable: args.executable,
      args: ["call", args.tool, JSON.stringify(args.arguments)],
      maxOutputBytes: CUA_DRIVER_MAX_OUTPUT_BYTES,
      timeoutMs: CUA_DRIVER_TIMEOUT_MS,
    }));
  } catch (error) {
    mapCuaDriverError(error);
  }
  return parseCuaDriverJson(stdout);
}

function nativeWindowCandidates(result: JsonValue): Array<{
  pid: number;
  title: string;
  windowId: number;
}> {
  const candidates = Array.isArray(result)
    ? result
    : typeof result === "object" &&
        result !== null &&
        !Array.isArray(result) &&
        Array.isArray(result.windows)
      ? result.windows
      : [];
  return candidates.flatMap((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof candidate.pid !== "number" ||
      typeof candidate.window_id !== "number"
    ) {
      return [];
    }
    const title =
      typeof candidate.title === "string"
        ? candidate.title
        : typeof candidate.name === "string"
          ? candidate.name
          : "";
    return [{ pid: candidate.pid, title, windowId: candidate.window_id }];
  });
}

export async function callComputerUseTool(
  command: CommandOf<"host.computer_use.call">,
  dataDir: string,
  runtime: ComputerUseRuntime = defaultRuntime,
): Promise<HostDaemonOnlineRpcResult<"host.computer_use.call">> {
  const executable = await resolveCuaDriverExecutable(runtime);
  if (executable === null) {
    throw new ExpectedCommandDispatchError(
      "computer_use_driver_not_found",
      "CUA Driver is not installed in an official location. Install it from https://cua.ai/driver.",
    );
  }
  try {
    const embeddedResult = await embeddedBrowserComputerUseBridge.handle({
      arguments: command.arguments,
      dataDir,
      inspectNativeWindow: async ({ instanceId, pid, windowId }) => {
        const windows = nativeWindowCandidates(
          await invokeCuaDriver({
            arguments: { on_screen_only: true, pid },
            executable,
            runtime,
            tool: "list_windows",
          }),
        );
        const exact = windows.filter(
          (window) => window.pid === pid && window.windowId === windowId,
        );
        if (exact.length !== 1) {
          throw new EmbeddedBrowserComputerUseError(
            "computer_use_embedded_browser_wrong_instance",
            `Expected exactly one on-screen window ${windowId} for Jack's IDE pid ${pid}; found ${exact.length}.`,
          );
        }
        const window = exact[0];
        if (
          window === undefined ||
          !window.title.includes(`[instance:${instanceId}]`)
        ) {
          throw new EmbeddedBrowserComputerUseError(
            "computer_use_embedded_browser_wrong_instance",
            `Window ${windowId} does not identify Jack's IDE instance ${instanceId}.`,
          );
        }
        return { pid, title: window.title, windowId };
      },
      tool: command.tool,
    });
    if (embeddedResult !== null) {
      return { tool: command.tool, result: embeddedResult };
    }
  } catch (error) {
    if (error instanceof EmbeddedBrowserComputerUseError) {
      throw new ExpectedCommandDispatchError(error.code, error.message);
    }
    throw error;
  }
  const driverResult = await invokeCuaDriver({
    arguments: command.arguments,
    executable,
    runtime,
    tool: command.tool,
  });
  if (
    command.tool === "end_session" &&
    typeof command.arguments.session === "string"
  ) {
    embeddedBrowserComputerUseBridge.releaseSession(command.arguments.session);
  }
  return {
    tool: command.tool,
    result: driverResult,
  };
}

export const computerUseTestSupport = {
  CUA_DRIVER_MAX_OUTPUT_BYTES,
  CUA_DRIVER_TIMEOUT_MS,
  CuaDriverProcessError,
  resolveCuaDriverExecutable,
};
