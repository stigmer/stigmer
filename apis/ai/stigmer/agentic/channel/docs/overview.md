A Channel is a way people reach an agent. Its type says which: `web` (a
hosted chat link and the chat widget for your own site), `slack` (a Slack
workspace) or `whatsapp` (a WhatsApp Business number). Every type declares
the agent it serves, whether serving is enabled, the shared vaults that
supply the agent's tool credentials, and the per-turn run settings; each
type adds its own settings. An agent has as many channels as it needs, and
deleting the agent deletes them.

A web channel's chat link is `/chat/<channel id>`: it names the channel
only by its permanent ID, so renaming the organization or the channel never
breaks it. The audience says who may chat there (anyone with the link, or
the organization's members), `allowed_origins` limits which sites may embed
the widget, and `messages` overrides what visitors see when a limit refuses
them.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Channel
metadata:
  name: variance-reporter-web
  org: workshop
spec:
  agent_ref:
    kind: agent
    org: workshop
    slug: variance-reporter
  enabled: true
  web:
    audience: channel_audience_public
    allowed_origins:
      - "https://docs.example.com"
    messages:
      rate_limited: "You're sending messages too quickly — give it a moment."
  vaults:
    - kind: vault
      org: workshop
      slug: ledger-keys
```

A Slack channel installs through the shared Stigmer app unless `app_ref`
names your own ChannelApp. The workspace's identity and credentials are
produced by the install and live in status, so applying a manifest never
touches them.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Channel
metadata:
  name: variance-reporter-slack
  org: workshop
spec:
  agent_ref:
    kind: agent
    org: workshop
    slug: variance-reporter
  enabled: true
  slack: {}
```

A WhatsApp channel names the Business phone number it serves and always
installs through your own Meta app. It is reply-only until its owner sets
`proactive_messaging_enabled`, which lets the agent send business-initiated
messages (reminders, notifications) through `sendMessage`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Channel
metadata:
  name: variance-reporter-whatsapp
  org: workshop
spec:
  agent_ref:
    kind: agent
    org: workshop
    slug: variance-reporter
  enabled: true
  whatsapp:
    phone_number_id: "106540352242922"
    app_ref:
      kind: channel_app
      org: workshop
      slug: acme-whatsapp
    proactive_messaging_enabled: true
```
