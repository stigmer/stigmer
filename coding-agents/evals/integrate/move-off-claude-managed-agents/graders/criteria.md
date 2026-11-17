---
type: llm
---

PASS if the answer maps their code to Stigmer as the docs do:
- reading and answering events carries over: point Anthropic's SDK at Stigmer (`new Anthropic({ baseURL: "https://api.stigmer.ai", apiKey: <a Stigmer API key> })`, or the server's own address when self-hosted), and `client.beta.sessions.events.list`, `events.stream` and `events.send` (`user.message`, `user.tool_confirmation` with `allow`/`deny`, `user.interrupt`) work against a Stigmer Session; the compatibility is with `managed-agents-2026-04-01` as typed by `@anthropic-ai/sdk` 0.131.0, the version tested;
- creating Sessions does not carry over: Sessions are created through Stigmer's own API (its SDK) or console, then their IDs are used with Anthropic's SDK; the same goes for Agents and Environments (an Environment keeps Managed Agents' fields, made with `stigmer apply` or Stigmer's API);
- custom tools have no counterpart: serve the tool from an MCP server, since Stigmer runs every tool itself and never writes `agent.custom_tool_use`;
- outcomes have no counterpart: a session has no outcome rubric; Scores grade a finished run afterwards (and evals test changes);
- self-hosting runs the whole of Stigmer on their servers.
Welcome but optional: other rows of the mapping (webhooks → follow the Session's events, permission policies → approval flows, budgets → a cost cap per message); Stigmer's own `stigmer.*` events are not returned through Anthropic's SDK; turning off the SDK's retry for sends; only the TypeScript SDK is tested against Stigmer.

FAIL if the answer says everything carries over unchanged, including session creation, custom tools or outcomes; invents a Stigmer equivalent for custom tools or outcomes the docs don't name; says they must rewrite their event handling on Stigmer's own SDK with no mention that Anthropic's SDK works for events; or names an untested SDK version as the supported one.
