What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
