An Organization is the top-level container for all Stigmer resources. Every
agent, workflow, session, and project belongs to exactly one organization,
providing multi-tenant isolation and access control.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: acme-corp
  slug: acme
spec:
  description: "Acme Corp engineering team"
  logo_url: "https://cdn.example.com/acme-logo.svg"
```
