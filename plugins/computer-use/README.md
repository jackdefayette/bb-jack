# Computer Use

Computer Use is an optional BB Official plugin that exposes a bounded,
provider-independent desktop-control surface backed by the open-source
[CUA Driver](https://github.com/trycua/cua). Install CUA Driver on the execution
host, grant its OS permissions, then install the plugin:

```bash
bb plugin install computer-use
bb computer-use status
```

Type `/computer-use` in a four-pane Build or Agent composer to load the skill.
The plugin registers three provider-neutral agent tools: `computer_use_inspect`,
`computer_use_act`, and `computer_use_verify`.

## CLI

```bash
bb computer-use status [--json]
bb computer-use call list_windows --args '{"on_screen_only":true}' --json
bb computer-use call get_window_state --args '{"pid":123,"window_id":456}'
```

Inside a task, the CLI resolves that task's execution host. Outside a task,
pass `--host <id>` to `call`.

## Typed RPC and SDK

Frontend code can import `computerUseRpcContract` and use
`useRpc<typeof computerUseRpcContract>()`. Server-side plugin code can call the
same RPC through the generic SDK while retaining output validation:

```ts
const result = await bb.sdk.plugins.callRpc({
  pluginId: "computer-use",
  method: "call",
  input: {
    hostId,
    tool: "get_screen_size",
    arguments: {},
  },
  outputSchema: computerUseRpcContract.call.output,
});
```

The public host capability is
`bb.hosts.experimental_callComputerUse(hostId, tool, arguments)`. Both the
server contract and host daemon enforce the fixed tool allowlist. The daemon
uses child-process argv rather than a shell, caps combined output, times out
calls, and rejects non-JSON results.

V1 excludes force-kill, clipboard read, unrestricted filesystem access,
downloads, and attaching to an existing browser profile.
