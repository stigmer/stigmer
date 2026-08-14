An IdentityAccount represents a user or machine principal in Stigmer. It is the
core identity primitive for authentication and authorization. Accounts can be
direct (signed up via Stigmer), federated (provisioned through an external
identity provider), or machine (service-to-service credentials).

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityAccount
metadata:
  name: alice
spec:
  idp_id: "auth0|abc123def456"
  email: alice@example.com
  first_name: Alice
  last_name: Smith
  provisioning_mode: direct
```
