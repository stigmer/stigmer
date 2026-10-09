An OAuthApp registers your Organization's OAuth client credentials with an
external vendor (Slack, GitHub, Figma, etc.) so Stigmer can acquire access
tokens on behalf of users. It lists the addresses it signs in to: a sign-in at
one of them, by anyone in the Organization, uses this app, ahead of Stigmer's
built-in app for the address and of the address's own login server. Each address
belongs to one app in an Organization.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: OAuthApp
metadata:
  name: Slack OAuth
  slug: slack-oauth
  org: acme
spec:
  provider: "Slack"
  client_id: "1234567890.abcdef"
  client_secret: "xoxs-..."
  authorization_url: "https://slack.com/oauth/v2/authorize"
  token_url: "https://slack.com/api/oauth.v2.access"
  scopes: ["channels:read", "chat:write"]
  addresses: ["https://mcp.slack.com/mcp"]
```
