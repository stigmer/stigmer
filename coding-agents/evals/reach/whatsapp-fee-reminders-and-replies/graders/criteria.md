---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says replies come through a WhatsApp channel on Stigmer Cloud, through their own Meta app registered in Stigmer, which needs a WhatsApp Business account with a number not on any WhatsApp phone app.
- Says WhatsApp delivers free-form text only within 24 hours of the member's last message, so a reminder needs a message template approved in WhatsApp Manager, not written in Stigmer.
- Says they switch on proactive messaging on the channel (for example `proactive_messaging_enabled: true`), which lets the Agent send the approved templates.
- Says the reminder sweep is a scheduled routine whose message tells the Agent to find members due in 3 days and send the template, since a routine's run can message any recipient and a channel conversation's cannot.

**FAIL if**

- It says the Agent can send free-form messages to anyone at any time.
- It says templates are written inside Stigmer.
- It says WhatsApp works without their own Meta app, or on an open-source self-hosted server.
- It invents a command or field the docs don't name (such as `stigmer whatsapp send`).
- It tells them to build the reminder sender outside Stigmer as the answer.

**Welcome**

- The rest of what Meta asks: a Meta Business portfolio with complete business info, a live privacy policy URL to publish the app, the App ID, App secret and a permanent system-user access token.
- Connecting with **Add channel → WhatsApp** and the number's phone number ID; members message the number and the Agent answers.
- Each send returns accepted, queued or refused.
- The channel's **Templates** view shows which approved templates can be sent and why not.
- Tool keys come from the vaults attached to the channel.
- Approvals are skipped on the channel.
- Members send text only.
- The Meta app must be published and its credentials registered in Stigmer as a Channel App.
- The template is a Utility template.
- Proactive messaging gives the Agent a `send_channel_message` tool and the approved templates in its context, set in the channel's `whatsapp` settings.
- A run an operator starts (a console conversation or a routine) can message any recipient within the send caps, while a run a channel conversation started can message only people who already wrote to the channel.
