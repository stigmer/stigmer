What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The run's phase becomes `waiting`, and the `stigmer.permission.asked` event carries the message to show the ops person.
- A deny's `denyMessage` is read by the Agent, which adapts to it.
- The run waits durably, through server restarts.
- `grantPermission` allows a call and every call of its kind for the rest of the turn, and why not to use it here.
- Only the Session's owner approves a tool call, so the backend that started the Session answers after the ops person decides in their screen.
- On Slack, WhatsApp or a chat link there is no approver, and a tool that asks is skipped there.
- Stigmer reads the annotation from the live server at the start of every turn.
- The Java details: `client.sendAndWait` or `client.waitForTurn` returns `TurnOutcome.WAITING` with its `asks`; on the event stream (`client.session.streamEvents(StreamSessionEventsRequest...)`) the tool call carries `evaluated_permission` `ask`, then the `stigmer.permission.asked` event and the Session idle with `requires_action`.
- `ConfirmToolUseInput` names the `sessionId`, the `toolUseId` and `result` `allow` or `deny` (with an optional `denyMessage`); the run resumes once every waiting call is answered, and on the `waitForTurn` route the backend calls `client.waitForTurn` again with the outcome's `lastSeq`.
