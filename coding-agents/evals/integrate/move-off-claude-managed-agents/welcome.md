What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The events `send` accepts: `user.message`, `user.tool_confirmation` with `allow` or `deny`, `user.custom_tool_result`, and `user.interrupt`.
- The compatibility is with `managed-agents-2026-04-01` as typed by `@anthropic-ai/sdk` 0.131.0, the version tested.
- Agents and Environments are also made through Stigmer (an Environment keeps Managed Agents' fields, made with `stigmer apply` or Stigmer's API).
- Self-hosting runs the whole of Stigmer on their servers.
- Evals test changes, beside Scores grading finished runs.
- Other rows of the mapping: webhooks become following the Session's events, permission policies become approval flows, budgets become a cost cap per message.
- Stigmer's own `stigmer.*` events are not returned through Anthropic's SDK.
- Turning off the SDK's retry for sends.
- Only the TypeScript SDK is tested against Stigmer.
- The client: `new Anthropic({ baseURL: "https://api.stigmer.ai", apiKey: <a Stigmer API key> })`, or their own server's address when self-hosted, with `client.beta.sessions.events.list`, `events.stream` and `events.send`.
- A custom tool's answer is text, and only the Session's owner sends it; a conversation nobody can answer (a chat link's visitor, a channel, a schedule) is offered no custom tools.
