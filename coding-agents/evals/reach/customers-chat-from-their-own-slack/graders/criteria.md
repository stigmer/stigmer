---
type: llm
---

PASS if the answer says yes, through a Slack channel on the Agent, and gets these right:
- An Organization admin adds it from the Agent's **Channels** tab (**Add channel → Slack**) on Stigmer Cloud, and Slack's consent page installs the bot into one workspace; installing needs permission to install apps in that workspace (or a Slack admin's approval). Each connected workspace is a channel of its own.
- People DM the bot or @mention it in a channel; a mention's thread is that person's conversation.
- By default the bot is the platform's **Stigmer** app and carries that name; to show as their own brand they register their own Slack app as a Channel App (**Settings → Channel Apps**, from the generated manifest) and connect through it. A workspace hosts one Agent per Slack app.
- The Agent's tools take keys only from the vaults attached to the channel, never anyone's own vault, so each customer's workspace channel gets a vault with that customer's keys.
- Conversations run on the Organization's own model provider keys, with per-user and workspace rate limits and the Agent's cost cap.

Welcome but optional: tool calls that need approval are skipped in Slack, so the Agent should confirm in conversation and use tools that don't ask; Enterprise Grid org-wide installs are not supported; the channel can be managed as a `kind: Channel` manifest with `slack: {}` and a pinned `run_config.model_name`; an admin can read the conversations in the console but cannot reply there. Saying plainly that the docs describe the install from the integrator's own console and do not describe how a customer's workspace admin installs it themselves is a plus.

FAIL if it invents a customer self-install link, a Slack App Directory listing, or an API the docs don't name; says the bot's name can change per workspace without their own app; says Slack works on an open-source self-hosted server; says workspace members get approval prompts; or attaches someone's My vault to the channel.
