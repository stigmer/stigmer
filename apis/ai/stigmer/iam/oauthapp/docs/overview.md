An OAuthApp registers your OAuth client credentials with an external vendor
(Slack, GitHub, Figma, etc.) so Stigmer can acquire access tokens on behalf of
users. MCP Servers reference an OAuthApp via `spec.auth.oauth_app_ref` to
enable automated credential acquisition through the OAuth authorization flow.

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
```
