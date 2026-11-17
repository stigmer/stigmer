---
type: llm
---

PASS if the answer gives the documented setup, one Organization per customer under theirs:
- each firm gets a **child organization** of their Organization, created at sign-up with the organization client's create call, naming `parentOrg` (their Organization) and optionally `externalId` (their own customer id, unique among the parent's children, so the child can be found later by it);
- creating an Organization is refused from a service account; it is done with an admin's own API key limited to their Organization (`stigmer apikey create --name ... --bound-org <their-org>`);
- the shared Agent stays in their Organization and is shared with child organizations (console **Manage access → General access → Child organizations**, `visibility_child_orgs`), so every firm, including later ones, runs it inside its own Organization;
- each firm's people sign in to that firm's Organization: their backend mints each user's token with `org` set to the firm's Organization (the admin service account can, since an admin of the parent is an admin of each child), or, with identity federation, the Federation Issuer's `externalIdClaim` routes each token to the child whose `externalId` matches; and the chat names the Agent by their Organization while the conversation lives in the firm's.
- it states the edition limits: child organizations are on Stigmer Cloud plans that include them and on Stigmer Enterprise as its license allows; the open-source server holds one Organization, where the fallback is a vault per customer that the backend names when it starts that customer's conversations.
Welcome but optional: Go names (`client.Organization.Create`, `client.Tokens.MintUserToken`); that each person's own conversations stay private even from the parent's admins; customer keys in a vault in the customer's Organization.

FAIL if the answer has them keep every firm in one Organization and separate them only with labels, naming conventions or their own filtering; says a service account's key creates the child organizations; invents a "tenant" resource, a `tenantId` field or API calls the docs don't name; copies the Agent into every firm instead of sharing it; or claims child organizations work on the open-source server.
