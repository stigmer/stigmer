---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says yes, through a Slack channel on the Agent on Stigmer Cloud, added by someone who can edit the Agent (for example **Add channel → Slack** on its **Channels** tab), which installs the bot into one workspace.
- Says by default the bot is the platform's **Stigmer** app and carries that name, and to show as their own brand they register their own Slack app with Stigmer as a Channel App and connect through it.
- Says the Agent's tools take keys only from the vaults attached to the channel, never anyone's own vault, so each customer's workspace channel gets a vault with that customer's keys.

**FAIL if**

- It invents a customer self-install link, a Slack App Directory listing, or an API the docs don't name.
- It says the bot's name can change per workspace without their own app.
- It says Slack works on an open-source self-hosted server.
- It says workspace members get approval prompts.
- It attaches someone's My vault to the channel.

**Welcome**

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
