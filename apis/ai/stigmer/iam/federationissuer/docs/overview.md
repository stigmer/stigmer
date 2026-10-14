A FederationIssuer is an outside issuer whose tokens Stigmer accepts for its
own users. It configures how Stigmer validates the tokens that issuer's users
present on each request, and how their federated identity accounts are created.
Served by the Enterprise and Cloud editions; the open-source server answers
UNIMPLEMENTED.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: FederationIssuer
metadata:
  name: Planton
  slug: planton
  org: planton
spec:
  display_name: "Planton"
  jwks_uri: "https://planton-prod.us.auth0.com/.well-known/jwks.json"
  allowed_issuers: ["https://planton-prod.us.auth0.com/"]
  expected_audience: "https://api.planton.ai/"
  userinfo_endpoint: "https://planton-prod.us.auth0.com/userinfo"
```
