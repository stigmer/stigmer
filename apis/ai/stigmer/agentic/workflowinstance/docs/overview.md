A WorkflowInstance binds a reusable Workflow template to the Environment resources
that supply credentials, secrets, and configuration for execution. Create multiple
instances of the same Workflow to target different environments (dev, staging, prod).

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: deploy-service-prod
  slug: deploy-service-prod
spec:
  workflow_id: wfl_01abc123def456789
  description: "Production deployment with AWS and GitHub credentials"
  environment_refs:
    - kind: environment
      slug: base-config
    - kind: environment
      slug: aws-prod-env
```
