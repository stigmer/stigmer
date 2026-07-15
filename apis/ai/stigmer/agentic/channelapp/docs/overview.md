A ChannelApp registers your own messaging-platform app (such as a Slack app
you created) for serving agent channels. Channels that reference a ChannelApp
via `spec.app_ref` install through your app instead of the shared Stigmer
app, so the bot carries your name and icon, and multiple agents can serve
the same workspace. Secret fields are encrypted at rest and redacted in
responses.

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
