---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says how to see what the run wants to do from the CLI, for example `stigmer runs logs <run-id>`, which shows the waiting tool call, or re-attaching with `stigmer resume <session-id>`.
- Says how to let it carry on from the CLI, for example `stigmer runs approve <run-id>` or answering the approval in the re-attached `stigmer resume` session.
- For the scripted nightly job, says to start the run so tool calls that ask are answered without a person, for example `stigmer run --approve-default allow` (or `allow-all`) or `--auto-approve`.

**FAIL if**

- It says the run times out or must be restarted.
- It tells them to cancel the run and run it again as the fix.
- It invents a command or flag the CLI reference does not list, for example `stigmer approve` or `stigmer runs approve --all`.
- It claims an approval can only be given in the console.

**Welcome**

- The run is paused on a tool call that needs a yes and waits durably, indefinitely, without losing state, even through a server restart.
- What asks by default: shell commands, file writes and deletes, and MCP tools their server marks destructive (`destructiveHint: true`).
- `stigmer runs approve` takes `--action allow`, `deny` or `allow-all` (allow it and every waiting call of its kind for the rest of the turn), and `--tool-call` to name one call by the tool use id `stigmer runs logs` shows.
- `--action deny` with `--comment` gives the Agent a reason, and the Agent carries on without the call.
- Off a terminal, `stigmer run` with `--approve-default` unset denies each call that asks, and the agent carries on without it.
- A hook's refusal still holds under `--auto-approve` or `allow-all`.
- The Agent's `tools` and `disallowed_tools` lists keep it away from a tool entirely, rather than asking about it.
- The run id can be found with `stigmer list runs`, and `stigmer get session <session-id>` shows the Session's newest runs.
