What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The run is paused on a tool call that needs a yes and waits durably, indefinitely, without losing state, even through a server restart.
- What asks by default: shell commands, file writes and deletes, and MCP tools their server marks destructive (`destructiveHint: true`).
- `stigmer runs approve` takes `--action allow`, `deny` or `allow-all` (allow it and every waiting call of its kind for the rest of the turn), and `--tool-call` to name one call by the tool use id `stigmer runs logs` shows.
- `--action deny` with `--comment` gives the Agent a reason, and the Agent carries on without the call.
- Off a terminal, `stigmer run` with `--approve-default` unset denies each call that asks, and the agent carries on without it.
- A hook's refusal still holds under `--auto-approve` or `allow-all`.
- The Agent's `tools` and `disallowed_tools` lists keep it away from a tool entirely, rather than asking about it.
- The run id can be found with `stigmer list runs`, and `stigmer get session <session-id>` shows the Session's newest runs.
