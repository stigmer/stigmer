---
type: llm
---

PASS if the answer covers both halves in the docs' terms:
- **Replies.** A WhatsApp channel on the Agent, on Stigmer Cloud, always through their own Meta app registered in Stigmer as a Channel App (a Meta Business portfolio with complete business info, a WhatsApp Business account with a number not on any WhatsApp phone app, a published Meta app with its App ID and App secret, a live privacy policy URL), then **Add channel → WhatsApp** with the number's phone number ID. Members message the number and the Agent answers.
- **Reminders.** WhatsApp delivers free-form text only within 24 hours of the member's last message; reaching out first needs a message template (a Utility template for reminders) authored and approved in WhatsApp Manager, not in Stigmer. They turn on `proactive_messaging_enabled: true` in the channel's `whatsapp` settings, which gives the Agent a `send_channel_message` tool and the approved templates in its context.
- A run an operator starts (a console conversation or a routine) can message any recipient within the send caps, while a run a channel conversation started can message only people who already wrote to the channel; so the daily "due in 3 days" sweep is a routine on a schedule whose message tells the Agent to find those members and send the template.

Welcome but optional: each send returns accepted, queued or refused; the channel's **Templates** view shows which approved templates can be sent and why not; tool keys come from the vaults attached to the channel; approvals are skipped on the channel; members send text only.

FAIL if it says the Agent can send free-form messages to anyone at any time; says templates are written inside Stigmer; says WhatsApp works without their own Meta app or on an open-source self-hosted server; invents a command or field the docs don't name (such as `stigmer whatsapp send`); or tells them to build the reminder sender outside Stigmer as the answer.
