A WorkflowRun represents a single run of a Workflow, pinned to the version
the Workflow had when the run started. It captures the full lifecycle of a workflow run — from trigger through task-by-task
run to completion or failure. Create a WorkflowRun to start a workflow,
then read its status to track progress.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: WorkflowRun
metadata:
  name: onboarding-20250111-143022
spec:
  workflow_id: wfl_01customeronboarding
  trigger_message: "New signup: john.doe@example.com"
  trigger_metadata:
    source: api
    caller_id: usr-jane-admin
  runtime_env:
    CUSTOMER_EMAIL:
      value: "john.doe@example.com"
```
