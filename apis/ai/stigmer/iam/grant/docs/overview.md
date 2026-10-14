A Grant gives a specific permission to a principal on a resource. It
binds three elements: WHO (principal), WHAT (resource), and HOW (relation).
Grants are the source of truth for authorization in Stigmer.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: Grant
metadata:
  name: alice-org-admin
  org: acme
spec:
  principal:
    kind: identity_account
    id: ia_alice-123
  resource:
    kind: organization
    id: org_acme-456
  relation: admin
```
