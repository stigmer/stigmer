A Vault holds the logins and secrets your runs use. Logins are matched to a
tool by its address and secrets by their name; saved values can be replaced
but are never shown again. Everyone has their own My vault, and an
organization's admins can create shared vaults for a team.

A login is saved by signing in to a tool or by pasting a token, and serves
every tool at that address. A run reads My vault only when its conversation
includes it (`include_my_vault`), or when its owner's own Schedule names it.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Vault
metadata:
  name: Support tools
spec:
  description: "The support team's Zendesk key"
  external_id: "customer-1234"
```
