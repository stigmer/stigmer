---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Says each firm gets a child organization of their Organization, created by the onboarding service at sign-up (for example the organization create call naming `parentOrg`, optionally with `externalId`).
- Says a service account's key cannot create Organizations, so the onboarding service does it with an admin's own API key (for example one bound to their Organization).
- Says the contract-review Agent stays in their Organization and is shared with child organizations, so every firm, including later ones, runs it inside its own Organization.
- Says each firm's people land in that firm's Organization, either by their backend minting each user's token for the firm's Organization or by federation routing each token to the child whose external id matches.

**FAIL if**

- It has them keep every firm in one Organization and separate them only with labels, naming conventions or their own filtering.
- It says a service account's key creates the child organizations.
- It invents a "tenant" resource, a `tenantId` field, or API calls the docs don't name.
- It copies the Agent into every firm instead of sharing it.
- It claims child organizations work on the open-source server.

**Welcome**

- The edition limits: child organizations are on Stigmer Cloud plans that include them and on Stigmer Enterprise as its license allows; the open-source server holds one Organization, where the fallback is a vault per customer that the backend names when it starts that customer's conversations.
- `externalId` is unique among the parent's children, so the child can be found later by it.
- The chat names the Agent by their Organization while the conversation lives in the firm's.
- Go names (`client.Organization.Create`, `client.Tokens.MintUserToken`).
- Each person's own conversations stay private even from the parent's admins.
- Customer keys in a vault in the customer's Organization.
- The bound key: `stigmer apikey create --name ... --bound-org <their-org>`.
- Sharing with children is **Manage access → General access → Child organizations** in the console, or `visibility_child_orgs`.
- The admin service account can mint for a child, since an admin of the parent is an admin of each child; with federation, the Federation Issuer's `externalIdClaim` names the child.
