---
type: llm
---

PASS if the answer gives the documented approval flow end to end:
- making those calls ask first: mark the tools destructive on their MCP server (`destructiveHint: true`), which Stigmer reads from the live server at the start of every turn, or a hook that asks before the call;
- finding out it waits: the call is an `agent.tool_use` / `agent.mcp_tool_use` with `evaluated_permission` `ask`, a `stigmer.permission.asked` event carries the message to show, the run's phase becomes `waiting` and the Session goes idle with `requires_action`; the backend reads this by streaming the Session's events (`client.session.streamEvents(StreamSessionEventsRequest...)`) or from `client.sendAndWait` / `client.waitForTurn` returning `TurnOutcome.WAITING` with its `asks`;
- answering: `client.session.confirmToolUse(ConfirmToolUseInput...)` with the `sessionId`, the call's `toolUseId`, `result` `allow` or `deny`, and an optional `denyMessage` the Agent reads and adapts to; then `client.waitForTurn` again with the outcome's `lastSeq`; the run resumes once every waiting call is answered, and it waits durably, through restarts.
Welcome but optional: `grantPermission` to allow every call of that kind for the rest of the turn (and why not to use it here); only the Session's owner answers a waiting call, so the backend that started the Session answers after the ops person decides in their screen; on Slack, WhatsApp or a chat link there is no approver and a tool that asks is skipped there.

FAIL if the answer invents an approval webhook, an `approve()` REST endpoint or SDK calls the docs don't name; says the Agent's instructions alone ("ask before disabling an account") guarantee a human yes; tells them to build their own pause-and-resume around the model; suggests `autoApproveAll` or trusting the whole run for these calls; or claims approvals can only be answered inside Stigmer's own chat UI.
