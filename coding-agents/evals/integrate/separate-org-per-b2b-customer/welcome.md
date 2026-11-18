What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The edition limits: child organizations are on Stigmer Cloud plans that include them and on Stigmer Enterprise as its license allows; the open-source server holds one Organization, where the fallback is a vault per customer that the backend names when it starts that customer's conversations.
- `externalId` is unique among the parent's children, so the child can be found later by it.
- The chat names the Agent by their Organization while the conversation lives in the firm's.
- Go names (`client.Organization.Create`, `client.Tokens.MintUserToken`).
- Each person's own conversations stay private even from the parent's admins.
- Customer keys in a vault in the customer's Organization.
- The bound key: `stigmer apikey create --name ... --bound-org <their-org>`.
- Sharing with children is **Manage access → General access → Child organizations** in the console, or `visibility_child_orgs`.
- The admin service account can mint for a child, since an admin of the parent is an admin of each child; with federation, the Federation Issuer's `externalIdClaim` names the child.
