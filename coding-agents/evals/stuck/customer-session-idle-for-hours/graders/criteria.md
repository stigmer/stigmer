---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the run is not hung: shell commands ask for approval by default, so the agent stopped before the command and the Session went idle waiting for a person, which it does indefinitely without losing state.
- Says how to answer it now by allowing or denying the waiting call, for example the SDK's `confirmToolUse` naming its tool use id, `stigmer runs approve <run-id>`, or the console.
- Says how to stop it recurring for a job nobody watches, for example keeping the Agent away from tools the job doesn't need (`tools` / `disallowed_tools`) or approving ahead where a human has already authorized it.

**FAIL if**

- It calls the run hung or crashed.
- It recommends cancel, terminate or retry as the fix.
- It invents an approval timeout or a setting the docs don't name.
- It recommends approving everything without saying that skips every approval.

**Welcome**

- The stop reason is `requires_action`, naming the waiting tool use, and the waiting call shows as a `stigmer.permission.asked` event.
- A server restart resumes the same wait.
- A deny with a reason lets the agent adapt.
- Killing and retrying would only stop at the same approval again.
- `grantPermission` allows every call of its kind for the rest of the turn.
- On a channel or a chat link's guest there is no approver, so a tool that asks is skipped there.
- `stigmer runs logs` shows the tool use id.
- The tool use id is read from the Session's events.
- The quickstart's Agent sets `disallowed_tools: [Bash]`; approving ahead is `auto_approve_all` on the run.
