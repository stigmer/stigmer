---
type: llm
---

PASS if the answer says, as the docs do: the run is paused on a tool call that needs a yes (by default shell commands, file writes and deletes, and MCP tools their server marks destructive) and waits durably, without timing out or losing state; `stigmer runs logs <run-id>` shows the waiting call and its tool use id; `stigmer runs approve <run-id>` answers it, with `--action allow`, `deny` (with `--comment` giving the agent a reason) or `allow-all` (every waiting call of its kind for the rest of the turn) and `--tool-call` to name one call; `stigmer resume <session-id>` re-attaching on a terminal is an alternative. For the scripted job: off a terminal `stigmer run` answers each asking call by `--approve-default` (`allow`, `deny`, `allow-all`; unset denies each one and the agent carries on without it), or `--auto-approve` approves everything; welcome but optional: a hook's refusal still holds, and the Agent's `tools` / `disallowed_tools` lists keep it away from a tool entirely.

FAIL if the answer says the run times out or must be restarted, tells them to cancel and rerun as the fix, invents a command or flag the CLI reference does not list (for example `stigmer approve`, `stigmer runs approve --all`), or claims an approval can only be given in the console.
