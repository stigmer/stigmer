---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says their event code carries over: Anthropic's SDK pointed at Stigmer's address with a Stigmer API key lists, streams and sends a Stigmer Session's events, tool confirmations included.
- Says creating Sessions does not carry over: Sessions are created through Stigmer's own API (its SDK) or console, and their IDs are then used with Anthropic's SDK.
- Says custom tools have no counterpart: Stigmer runs every tool itself, so the tool is served from an MCP server instead.
- Says outcomes have no counterpart: a Session has no outcome rubric, and Scores grade a finished run afterwards.

**FAIL if**

- It says everything carries over unchanged, including session creation, custom tools or outcomes.
- It invents a Stigmer equivalent for custom tools or outcomes the docs don't name.
- It says they must rewrite their event handling on Stigmer's own SDK, with no mention that Anthropic's SDK works for events.
- It names an untested SDK version as the supported one.

**Welcome**

- The events `send` accepts: `user.message`, `user.tool_confirmation` with `allow` or `deny`, and `user.interrupt`.
- The compatibility is with `managed-agents-2026-04-01` as typed by `@anthropic-ai/sdk` 0.131.0, the version tested.
- Agents and Environments are also made through Stigmer (an Environment keeps Managed Agents' fields, made with `stigmer apply` or Stigmer's API).
- Self-hosting runs the whole of Stigmer on their servers.
- Evals test changes, beside Scores grading finished runs.
- Other rows of the mapping: webhooks become following the Session's events, permission policies become approval flows, budgets become a cost cap per message.
- Stigmer's own `stigmer.*` events are not returned through Anthropic's SDK.
- Turning off the SDK's retry for sends.
- Only the TypeScript SDK is tested against Stigmer.
- The client: `new Anthropic({ baseURL: "https://api.stigmer.ai", apiKey: <a Stigmer API key> })`, or their own server's address when self-hosted, with `client.beta.sessions.events.list`, `events.stream` and `events.send`.
- Stigmer never writes `agent.custom_tool_use`.
