---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says the two calls are made to ask first by marking those tools destructive on their own MCP server (`destructiveHint: true`), or by a hook that asks before the call.
- Says how the Java backend learns a call is waiting, for example a `waitForTurn` or `sendAndWait` outcome of `WAITING` with its asks, or the Session's event stream showing the permission asked and the Session idle.
- Says the backend answers each waiting call with allow or deny through the SDK (for example `client.session.confirmToolUse` with the call's tool use id) after the ops person decides in their dashboard, and the run then resumes.

**FAIL if**

- It invents an approval webhook, an `approve()` REST endpoint, or SDK calls the docs don't name.
- It says the Agent's instructions alone ("ask before disabling an account") guarantee a human yes.
- It tells them to build their own pause-and-resume around the model.
- It suggests `autoApproveAll` or trusting the whole run for these calls.
- It claims approvals can only be answered inside Stigmer's own chat UI.

**Welcome**

- The run's phase becomes `waiting`, and the `stigmer.permission.asked` event carries the message to show the ops person.
- A deny's `denyMessage` is read by the Agent, which adapts to it.
- The run waits durably, through server restarts.
- `grantPermission` allows a call and every call of its kind for the rest of the turn, and why not to use it here.
- Only the Session's owner approves a tool call, so the backend that started the Session answers after the ops person decides in their screen.
- On Slack, WhatsApp or a chat link there is no approver, and a tool that asks is skipped there.
- Stigmer reads the annotation from the live server at the start of every turn.
- The Java details: `client.sendAndWait` or `client.waitForTurn` returns `TurnOutcome.WAITING` with its `asks`; on the event stream (`client.session.streamEvents(StreamSessionEventsRequest...)`) the tool call carries `evaluated_permission` `ask`, then the `stigmer.permission.asked` event and the Session idle with `requires_action`.
- `ConfirmToolUseInput` names the `sessionId`, the `toolUseId` and `result` `allow` or `deny` (with an optional `denyMessage`); the run resumes once every waiting call is answered, and on the `waitForTurn` route the backend calls `client.waitForTurn` again with the outcome's `lastSeq`.
