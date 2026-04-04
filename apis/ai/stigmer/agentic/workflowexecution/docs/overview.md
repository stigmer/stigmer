A WorkflowExecution represents a single runtime invocation of a WorkflowInstance.
It captures the full lifecycle of a workflow run — from trigger through task-by-task
execution to completion or failure. Create a WorkflowExecution to start a workflow,
then read its status to track progress.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: WorkflowExecution
metadata:
  name: onboarding-20250111-143022
spec:
  workflow_instance_id: wfi-customer-onboarding-prod
  trigger_message: "New signup: john.doe@example.com"
  trigger_metadata:
    source: api
    caller_id: usr-jane-admin
  runtime_env:
    CUSTOMER_EMAIL:
      value: "john.doe@example.com"
```
