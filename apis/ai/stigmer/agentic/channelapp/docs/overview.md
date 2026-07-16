A ChannelApp registers your own messaging-platform app (a Slack app or a
Meta app with WhatsApp Business access) for serving agent channels.
Channels that reference a ChannelApp via `spec.app_ref` install through
your app: for Slack this replaces the shared Stigmer app so the bot
carries your name and icon and multiple agents can serve the same
workspace; for WhatsApp a ChannelApp is the only install path. Secret
fields are encrypted at rest and redacted in responses.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ChannelApp
metadata:
  name: Acme Support Bot
  slug: acme-support-bot
  org: acme
spec:
  slack:
    client_id: "1234567890.abcdef"
    client_secret: "8f742a..."
    signing_secret: "9c31b8..."
```

A WhatsApp ChannelApp carries the Meta app's credentials and the verify
token you configure on its webhook:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ChannelApp
metadata:
  name: Acme WhatsApp
  slug: acme-whatsapp
  org: acme
spec:
  whatsapp:
    app_id: "735281906457812"
    app_secret: "e21c94..."
    access_token: "EAAKZB..."
    verify_token: "a-long-random-string"
```
