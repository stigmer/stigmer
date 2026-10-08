A Vault holds the logins and secrets your runs use. Logins are matched to a
tool by its address and secrets by their name; saved values can be replaced
but are never shown again. Everyone has their own My vault, and an
organization's admins can create shared vaults for a team.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Vault
metadata:
  name: Support tools
spec:
  description: "The support team's Zendesk key"
  external_id: "customer-1234"
```
