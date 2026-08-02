An AgentChannel connects an agent to an external messaging platform so
people can chat with it where they already work. The spec declares which
agent serves the channel, whether serving is enabled, the provider (Slack
or WhatsApp), optional environment references that supply the agent's tool
credentials for channel conversations, and an `app_ref` to a ChannelApp
when the channel installs through your own provider app — optional for
Slack (absent means the shared Stigmer app), required for WhatsApp.
Provider identity facts and credentials are produced by the install flow
and live in status — applying a manifest never touches them, and channel
operations never modify the referenced agent.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentChannel
metadata:
  name: support-agent-slack
  org: workshop
spec:
  agent_ref:
    kind: agent
    org: workshop
    slug: support-agent
  enabled: true
  slack: {}
  environment_refs:
    - kind: environment
      org: workshop
      slug: support-tools-credentials
```

A WhatsApp channel names the Business phone number it serves and always
installs through your own Meta app. A channel is reply-only until its
owner sets `proactive_messaging_enabled`, which lets the serving agent
send business-initiated messages (reminders, notifications) on the
channel through `sendMessage`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentChannel
metadata:
  name: support-agent-whatsapp
  org: workshop
spec:
  agent_ref:
    kind: agent
    org: workshop
    slug: support-agent
  enabled: true
  proactive_messaging_enabled: true
  whatsapp:
    phone_number_id: "106540352242922"
  app_ref:
    kind: channel_app
    org: workshop
    slug: acme-whatsapp
```
