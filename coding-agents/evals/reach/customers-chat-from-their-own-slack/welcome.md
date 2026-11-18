What a good answer may also say. Never graded: leaving any of it out fails nothing.

- People DM the bot or @mention it in a channel, and a mention's thread is that person's conversation.
- Conversations run on the Organization's own model provider keys, with per-user and workspace rate limits and the Agent's cost cap.
- A workspace hosts one Agent per Slack app.
- Tool calls that need approval are skipped in Slack, so the Agent should confirm in conversation and use tools that don't ask.
- Enterprise Grid org-wide installs are not supported.
- The channel can be managed as a `kind: Channel` manifest with `slack: {}` and a pinned `run_config.model_name`.
- An admin can read the conversations in the console but cannot reply there.
- Saying plainly that the docs describe the install from the integrator's own console and do not describe how a customer's workspace admin installs it themselves.
- Installing through Slack's consent page needs permission to install apps in that workspace, or a Slack admin's approval; each connected workspace is a channel of its own.
- The Channel App is registered under **Settings → Channel apps**, from the generated manifest.
