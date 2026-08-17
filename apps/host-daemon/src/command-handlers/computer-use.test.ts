import { describe, expect, it, vi } from "vitest";
import { callComputerUseTool, computerUseTestSupport } from "./computer-use.js";

function createRuntime(
  overrides: Partial<Parameters<typeof callComputerUseTool>[2]> = {},
): NonNullable<Parameters<typeof callComputerUseTool>[2]> {
  return {
    accessExecutable: vi.fn(async () => undefined),
    homeDir: "/Users/test",
    inspectProcess: vi.fn(async () => ({
      arguments:
        "/Users/test/bb/Electron.app/Contents/MacOS/Electron --user-data-dir=/tmp/bb/desktop .",
      executable: "/Users/test/bb/Electron.app/Contents/MacOS/Electron",
    })),
    platform: "darwin",
    readFile: vi.fn(async () => ""),
    run: vi.fn(async () => ({ stdout: '{"width":1470}', stderr: "" })),
    ...overrides,
  };
}

describe("callComputerUseTool", () => {
  it("passes the bounded tool call as child-process argv and parses JSON", async () => {
    const runtime = createRuntime({
      accessExecutable: vi.fn(async (candidate) => {
        if (!candidate.startsWith("/Applications/")) throw new Error("missing");
      }),
    });

    await expect(
      callComputerUseTool(
        {
          type: "host.computer_use.call",
          tool: "get_screen_size",
          arguments: { ignored: "$(touch /tmp/not-shell)" },
        },
        "/tmp/bb",
        runtime,
      ),
    ).resolves.toEqual({ tool: "get_screen_size", result: { width: 1470 } });
    expect(runtime.run).toHaveBeenCalledWith({
      executable: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      args: [
        "call",
        "get_screen_size",
        '{"ignored":"$(touch /tmp/not-shell)"}',
      ],
      maxOutputBytes: computerUseTestSupport.CUA_DRIVER_MAX_OUTPUT_BYTES,
      timeoutMs: computerUseTestSupport.CUA_DRIVER_TIMEOUT_MS,
    });
  });

  it("rejects the call when no trusted absolute installation exists", async () => {
    const accessExecutable = vi.fn(async () => {
      throw new Error("missing");
    });
    const runtime = createRuntime({ accessExecutable });

    await expect(
      callComputerUseTool(
        {
          type: "host.computer_use.call",
          tool: "check_permissions",
          arguments: {},
        },
        "/tmp/bb",
        runtime,
      ),
    ).rejects.toMatchObject({ code: "computer_use_driver_not_found" });

    expect(accessExecutable).toHaveBeenCalledTimes(2);
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", "computer_use_timeout"],
    ["output_too_large", "computer_use_output_too_large"],
    ["failed", "computer_use_driver_failed"],
  ] as const)("maps %s failures to %s", async (kind, code) => {
    const runtime = createRuntime({
      run: vi.fn(async () => {
        throw new computerUseTestSupport.CuaDriverProcessError(kind, "nope");
      }),
    });

    await expect(
      callComputerUseTool(
        {
          type: "host.computer_use.call",
          tool: "click",
          arguments: { x: 1, y: 2 },
        },
        "/tmp/bb",
        runtime,
      ),
    ).rejects.toMatchObject({ code, message: "nope" });
  });

  it("surfaces a non-JSON driver diagnostic instead of hiding it", async () => {
    const runtime = createRuntime({
      run: vi.fn(async () => ({ stdout: "not json", stderr: "" })),
    });

    await expect(
      callComputerUseTool(
        {
          type: "host.computer_use.call",
          tool: "check_permissions",
          arguments: {},
        },
        "/tmp/bb",
        runtime,
      ),
    ).rejects.toMatchObject({
      code: "computer_use_driver_failed",
      message: "not json",
    });
  });

  it("resolves Jack's IDE only when launcher, process, and window identities agree", async () => {
    const dataDir = "/Users/test/.bb-dev/documents-bb-jack-dadc42354ab7";
    const appPath =
      "/Users/test/Documents/bb-jack/node_modules/electron/dist/Electron.app";
    const userDataDir = `${dataDir}/desktop`;
    const runtime = createRuntime({
      inspectProcess: vi.fn(async () => ({
        arguments: `${appPath}/Contents/MacOS/Electron --user-data-dir=${userDataDir} --remote-debugging-port=0 .`,
        executable: `${appPath}/Contents/MacOS/Electron`,
      })),
      readFile: vi.fn(async () =>
        JSON.stringify({
          appUrl: "http://localhost:14957",
          instanceId: "documents-bb-jack-dadc42354ab7",
          pid: 15723,
          startedAtMs: 123,
          userDataDir,
        }),
      ),
      run: vi.fn(async ({ args }) => {
        const tool = args[1];
        if (tool === "list_windows") {
          return {
            stderr: "",
            stdout: JSON.stringify({
              windows: [
                {
                  pid: 15723,
                  title:
                    "Jack's CRM [instance:documents-bb-jack-dadc42354ab7] [window:main]",
                  window_id: 50929,
                },
              ],
            }),
          };
        }
        throw new Error(`Unexpected tool ${tool}`);
      }),
    });

    await expect(
      callComputerUseTool(
        {
          type: "host.computer_use.call",
          tool: "resolve_bb_desktop",
          arguments: {},
        },
        dataDir,
        runtime,
      ),
    ).resolves.toEqual({
      tool: "resolve_bb_desktop",
      result: {
        app_path: appPath,
        instance_id: "documents-bb-jack-dadc42354ab7",
        name: "Jack's IDE",
        pid: 15723,
        process_executable: `${appPath}/Contents/MacOS/Electron`,
        started_at_ms: 123,
        user_data_dir: userDataDir,
        window: {
          pid: 15723,
          title:
            "Jack's CRM [instance:documents-bb-jack-dadc42354ab7] [window:main]",
          window_id: 50929,
        },
      },
    });
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });

  it("refuses a managed PID using another Electron desktop profile", async () => {
    const dataDir = "/Users/test/.bb-dev/documents-bb-jack-dadc42354ab7";
    const userDataDir = `${dataDir}/desktop`;
    const runtime = createRuntime({
      inspectProcess: vi.fn(async () => ({
        arguments:
          "/tmp/old/Electron.app/Contents/MacOS/Electron --user-data-dir=/tmp/default-electron .",
        executable: "/tmp/old/Electron.app/Contents/MacOS/Electron",
      })),
      readFile: vi.fn(async () =>
        JSON.stringify({
          appUrl: "http://localhost:14957",
          instanceId: "documents-bb-jack-dadc42354ab7",
          pid: 15723,
          startedAtMs: 123,
          userDataDir,
        }),
      ),
    });

    await expect(
      callComputerUseTool(
        {
          type: "host.computer_use.call",
          tool: "resolve_bb_desktop",
          arguments: {},
        },
        dataDir,
        runtime,
      ),
    ).rejects.toMatchObject({
      code: "computer_use_bb_desktop_wrong_instance",
    });
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
