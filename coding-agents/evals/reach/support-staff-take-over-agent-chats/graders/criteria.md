---
type: llm
---

PASS if the answer describes the console's **Conversations** area on Stigmer Cloud:
- The **Needs a person** list and the sidebar badge show conversations that want a human, including ones the Agent escalated on its own (with its reason); **Take over** or **Dismiss** answers the flag.
- **Take over** (or simply sending a reply, which takes over implicitly) makes the Agent go quiet on that one conversation; the reply goes out through the channel's own number; a customer who writes before anyone replies gets one acknowledgment ("Someone from our team is looking at this and will reply here.").
- **Hand back to the agent** returns it; the Agent resumes on the customer's next message and receives a digest of what happened while it was quiet, so it does not repeat settled answers.
- Replying, taking over and handing back need the **Participant** role on the channel, granted from the channel card's **Manage access**; reading needs view access.
- On Slack it does not work the same: staff replies work on WhatsApp channels today; Slack conversations can be read, but only the Agent replies there.

Welcome but optional: WhatsApp's 24-hour window for free-form replies, with approved templates for reaching out past it; handing back warns when the customer's last message has no reply.

FAIL if it tells them to build their own handoff or inbox; invents an API, command or setting the docs don't name; says staff can reply in Slack conversations from the console; or says handing back makes the Agent answer immediately.
