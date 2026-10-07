An ExecutionContext holds ephemeral runtime configuration and secrets for a
single Run. The execution engine creates it at start and deletes it when
the run completes.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-abc123
  org: acme-corp
spec:
  execution_id: "run_abc123"
  data:
    AWS_REGION:
      value: "us-east-1"
      is_secret: false
    AWS_ACCESS_KEY_ID:
      value: "AKIAIOSFODNN7EXAMPLE"
      is_secret: true
```
