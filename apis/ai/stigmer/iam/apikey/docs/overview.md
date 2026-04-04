An ApiKey provides programmatic access to the Stigmer API on behalf of an
identity account. Each key is scoped to a single user or machine account and
can optionally be configured to expire.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: my-ci-key
spec:
  never_expires: false
  expires_at: "2026-12-31T00:00:00Z"
```
