---
name: computer-use
description: Inspect, operate, and verify desktop apps through the bounded, provider-independent CUA Driver bridge.
---

# Computer Use

Use this skill when the user asks you to read or operate desktop UI that is not
available through a more specific connector, API, or CLI.

## Loop

1. Create one short, non-empty session id for the run. Start with
   `computer_use_act({tool:"start_session", arguments:{session:"<id>",
   capture_scope:"window"}})`. `start_session` without `session` is invalid.
2. Call `computer_use_inspect` to list apps/windows and capture fresh window
   state. Ground on both the accessibility elements and screenshot when both
   are returned.
3. Call `computer_use_act` for exactly one bounded action.
4. Inspect fresh state again. Never reuse an element index, token, or snapshot
   after another state capture.
5. Call `computer_use_verify` for deterministic postconditions. Treat
   `unknown` as unverified, never as success.
6. End with `computer_use_act({tool:"end_session", arguments:{session:"<id>"}})`.

Prefer accessibility element tokens over coordinates. Use coordinates only for
custom-drawn surfaces missing from the accessibility tree. Keep the same CUA
`session` id in every supported call through one run and end it when finished.
Resolve `pid` and `window_id` from the latest list results before calling
`get_window_state`; both fields are required. If a tool returns an argument
diagnostic, correct the call instead of repeating it unchanged.

## Core argument shapes

- Inspection: `list_apps`, `list_windows`, `check_permissions`, and
  `get_accessibility_tree` accept `{}`. `list_windows` optionally accepts
  `{pid,on_screen_only}`. `get_window_state` requires `{pid,window_id}` and
  accepts `{session,query,include_screenshot}`.
- App focus: `launch_app` accepts `{bundle_id}` or `{name}`;
  `bring_to_front` requires `{pid}` and optionally `window_id`.
- Keyboard: `hotkey` requires `{keys:["cmd","p"]}`; `press_key` requires
  `{key:"return"}`; `type_text` requires `{text:"..."}`. Add `pid`,
  `window_id`, and `session` for the target window. Use
  `delivery_mode:"foreground"` only when a verified background attempt did not
  land.
- Accessibility actions: prefer the fresh `element_token` from
  `get_window_state`. When using `element_index`, also pass that snapshot's
  `snapshot_id` and `window_id`.
- Verification: pass `{pid,window_id,session,expect:[...]}`. Predicates may use
  `window:{exists:true}` or `element:{selector:{role,label_contains},
  exists:true|enabled|selected|value_equals}`.

The V1 bridge deliberately excludes force-kill, clipboard read, unrestricted
filesystem access, browser existing-profile attachment, downloads, and raw
shell execution. If the requested task needs one of those capabilities, stop
and explain the missing boundary instead of finding a bypass.

Follow the user's confirmation and credential boundaries. Never enter a
password, Touch ID response, or other authentication credential for them.
