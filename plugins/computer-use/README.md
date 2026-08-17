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
bb computer-use call resolve_bb_desktop --args '{}' --json
bb computer-use call list_windows --args '{"on_screen_only":true}' --json
bb computer-use call get_window_state --args '{"pid":123,"window_id":456}'
bb computer-use call get_browser_state --args '{"pid":123,"window_id":456,"session":"qa"}'
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

Development Electron processes share the generic `com.github.Electron`
identity. Use `resolve_bb_desktop` instead of selecting or launching that name
or bundle id. The resolver reads the managed launcher identity, verifies the
live executable and `--user-data-dir`, and requires CUA's exact PID plus the
instance-titled main window before returning an app path, PID, and window id.
Resolution is read-only and never launches another Electron shell.

Electron's embedded `WebContentsView` Browser is a separate compositor and
accessibility surface from the host window. The canonical development launcher
starts Electron with a loopback-only ephemeral DevTools endpoint and writes a
mode-0600 identity record inside that exact desktop profile. Bind an in-pane
page with `get_browser_state` arguments `{pid,window_id,session,embedded:true,
expected_url,expected_project_route?}`. The host daemon refuses unless the
profile PID, titled native window, renderer project route, visible browser tab,
and that tab's exact DevTools target all agree. Duplicate retained tabs at the
same URL therefore remain fail-closed but do not make the active tab ambiguous.
Returned snapshots include the page URL, project route,
capture timestamp, semantic accessibility elements, fresh action refs, and an
exact-tab screenshot. Embedded actions invalidate their input refs and return
`acted_at_ms`; pass that as `not_before_ms` on the next inspect or verify call.

The Browser chrome's **Open page in external browser for Computer Use** action
remains the fallback when the managed bridge is unavailable. Use it only when
opening an external browser is within the user's scope. The managed endpoint is
not enabled automatically in packaged builds.

V1 excludes force-kill, clipboard read, unrestricted filesystem access,
downloads, and setting up or attaching to an arbitrary existing browser
profile.
