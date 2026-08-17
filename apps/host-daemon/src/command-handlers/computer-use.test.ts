import { describe, expect, it, vi } from "vitest";
import { callComputerUseTool, computerUseTestSupport } from "./computer-use.js";

function createRuntime(
  overrides: Partial<Parameters<typeof callComputerUseTool>[2]> = {},
): NonNullable<Parameters<typeof callComputerUseTool>[2]> {
  return {
    accessExecutable: vi.fn(async () => undefined),
    homeDir: "/Users/test",
    platform: "darwin",
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
});
