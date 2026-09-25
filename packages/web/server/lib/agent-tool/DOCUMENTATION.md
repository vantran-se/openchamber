# Managed OpenChamber agent tools

## Purpose

This module exposes OpenChamber actions as typed OpenCode custom tools for Electron Desktop's managed OpenCode child.

The main tools are:

- `openchamber` for projects, sessions, worktrees, scheduled tasks, and `file.open`
- `openchamber_web` for inspecting and interacting with the page in OpenChamber's browser panel

Their persisted settings control whether each tool is present. Tool definitions include only the actions and inputs enabled for that tool.

## Runtime boundary

Electron Desktop owns the managed integration:

1. `materializePlugin()` writes the generated plugin under `<openchamber-data-dir>/agent-tool/`.
2. The managed OpenCode config lists that plugin directory.
3. `createChildEnv()` gives the owned OpenCode child a random callback token and loopback callback URL.
4. The plugin calls `POST /api/openchamber/agent-tool` with its typed input and OpenCode session ID.
5. OpenChamber resolves the session directory and delegates the fixed action allowlist to the shared control service.

The callback token stays in the managed child environment. It is never persisted, logged, returned to the UI, or written into the generated plugin.

Ordinary Web does not install a plugin, publish callback registration, or advertise managed OpenChamber tools to the shared local OpenCode service. This keeps shared Web limited to sessions and live events. A valid `OPENCODE_HOST` is also outside managed-tool ownership, so OpenChamber does not guarantee tools on that endpoint.

VS Code keeps its separate lifecycle. Hosted and Capacitor clients do not run tools themselves. They may connect to a Desktop-owned backend that has managed tools, but an ordinary Web backend does not add them.

## Input contract

The plugin accepts action inputs inside `parameters` or beside `action`. An explicit `parameters` object wins when both forms provide the same field.

Each action definition has a short presentation title and a separate agent-facing description. The generated schema uses descriptions only for required inputs, defaults, or behavior that a field name cannot explain.

The schema uses one shared parameter object with `oneOf` and no `enum`. Some OpenAI-compatible gateways reject a node that combines both and return an empty completion.

Session dispatch does not wait by default. Optional switches such as `worktree`, `goal`, `agent`, `variant`, and `wait` state their defaults and tell the agent not to invent them.

## Security invariants

- The callback accepts same-machine requests only and requires the current managed-child bearer token with a timing-safe comparison.
- A concrete listener address may accept a source equal to that address. A wildcard listener remains loopback-only.
- The plugin adds its callback host to `NO_PROXY` and `no_proxy` in the managed child so an environment proxy cannot receive the callback token.
- Inputs map to fixed tool, action, and parameter allowlists. There is no arbitrary CLI, shell, route, or URL forwarding.
- Project-path registration and session or worktree deletion are not exposed.
- A dropped callback request aborts its action.
- OpenCode 2 does not give plugin tools an abort signal. The server therefore tracks actions by session and aborts them when the event stream reports an aborted `session.idle` transition.

## Result contract

Completed calls return JSON:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "action": "session.create",
  "data": {}
}
```

Command and operational failures use the same envelope with `ok: false` and an `error` object. OpenCode-level cancellation can still produce a native tool error.

## Action resolution

Each generated tool sends its own name with every callback. Action resolution stays within that tool's allowlist. For example, a bare `open` requested by a memory tool cannot drive the browser.

When an action name is invalid, the response lists the actions available to the calling tool. This lets the model correct the call without guessing across tool namespaces.
