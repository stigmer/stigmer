# WorkflowExecution API Resource Reference

Schema reference for the `agentic.stigmer.ai/v1` WorkflowExecution resource. For conceptual overview and lifecycle, see [README.md](README.md).

## Resource Shape

A WorkflowExecution resource as returned by `stigmer get workflow-execution <id> --output yaml`:

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowExecution
metadata:
  id: wfx-abc123xyz456
  name: customer-onboarding-20250111-143022
  org: acme-corp
spec:
  workflow_instance_id: wfi-customer-onboarding-prod
  trigger_message: "New signup: john.doe@example.com"
  trigger_metadata:
    source: api
    caller_id: usr-jane-admin
    timestamp: "2025-01-11T14:30:22Z"
  runtime_env:
    CUSTOMER_EMAIL:
      value: john.doe@example.com
    STRIPE_API_KEY:
      secret_ref: sec-stripe-prod
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-1
      task_name: validate_email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_COMPLETED
      input:
        method: POST
        url: https://api.emailvalidator.com/v1/validate
        body:
          email: john.doe@example.com
      output:
        valid: true
        domain: example.com
      started_at: "2025-01-11T14:30:23Z"
      completed_at: "2025-01-11T14:30:23.450Z"
    - task_id: task-2
      task_name: create_account
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_IN_PROGRESS
      input:
        agent_instance_id: agi-account-creator
        prompt: "Create account for john.doe@example.com on plan=pro"
      started_at: "2025-01-11T14:30:24Z"
    - task_id: task-3
      task_name: send_welcome_email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_PENDING
  started_at: "2025-01-11T14:30:22Z"
  temporal_workflow_id: wfi-customer-onboarding-prod-wfx-abc123xyz456
  audit:
    created_at: "2025-01-11T14:30:22Z"
    updated_at: "2025-01-11T14:30:24Z"
    created_by: usr-jane-admin
```

## Top-Level Fields

| Field | Set By | Value |
|---|---|---|
| `api_version` | System | Always `agentic.stigmer.ai/v1` |
| `kind` | System | Always `WorkflowExecution` |
| `metadata` | System + author | See [Metadata Fields](#metadata-fields) |
| `spec` | Author | See [Spec Fields](#spec-fields) |
| `status` | System-managed | See [Status Fields](#status-fields) |

## Metadata Fields

| Field | Description |
|---|---|
| `metadata.id` | System-generated unique identifier. Format: `wfx-{ulid}`. Example: `wfx-abc123xyz456`. |
| `metadata.name` | Display name. Typically `{workflow-instance-name}-{timestamp}`. Example: `prod-deploy-20250111-143022`. |
| `metadata.org` | Organization that owns this execution. |
| `metadata.labels` | Key-value pairs. Common labels: `workflow_instance_id`, `workflow_id`, `trigger_source`. |
| `metadata.tags` | String tags for filtering. Common tags: environment names, team names. |

## Spec Fields

`WorkflowExecutionSpec` is defined in `spec.proto`. The spec is **immutable after creation** — it represents the inputs for this specific run. To retry with different inputs, create a new WorkflowExecution.

| Field | Required | Description |
|---|---|---|
| `spec.workflow_instance_id` | One of these two | ID of the WorkflowInstance to execute. Format: `wfi-{slug}`. |
| `spec.workflow_id` | One of these two | ID of the Workflow template. System resolves to the default instance (auto-created if missing). |
| `spec.trigger_message` | No | Input message or payload for the workflow. Accessible as `{{workflow.input.trigger_message}}` in task configs. |
| `spec.trigger_metadata` | No | Key-value metadata about who/what triggered this execution. For audit and analytics — not visible to workflow logic. |
| `spec.runtime_env` | No | Execution-scoped environment variables and secrets. Highest merge priority. |
| `spec.callback_token` | No | Temporal async task token for workflow-calling-workflow scenarios. See [Async Token Handshake](#async-token-handshake). |

### Instance Resolution

Either `workflow_instance_id` or `workflow_id` must be provided. The handler enforces this rule.

| Field Provided | Behavior |
|---|---|
| `workflow_instance_id` | Executes against the specified WorkflowInstance directly. |
| `workflow_id` | Resolves to the workflow's `status.default_instance_id`. If no default instance exists, one is auto-created as `{workflow-slug}-default`. |

### trigger_message

The primary input to the workflow — the "trigger event" or "request payload".

```yaml
# Conversational workflow trigger
spec:
  trigger_message: "Analyze sentiment of recent customer feedback for Q4"

# API payload trigger (JSON string)
spec:
  trigger_message: '{"customer_id": "cus-abc123", "action": "upgrade_plan", "target_plan": "enterprise"}'

# Event-driven trigger
spec:
  trigger_message: "Payment received: $99.00 for order #12345 by customer john.doe@example.com"
```

### trigger_metadata

Context metadata for audit, analytics, and debugging. Not exposed to workflow task logic.

```yaml
# API trigger
spec:
  trigger_metadata:
    source: api
    caller_id: usr-john-doe
    ip_address: "203.0.113.42"
    timestamp: "2025-01-11T14:30:22Z"

# Webhook trigger
spec:
  trigger_metadata:
    source: webhook
    webhook_id: whk-stripe-payment-received
    webhook_source: stripe.com
    event_type: payment_intent.succeeded
    event_id: evt_1NqZP92eZvKYlo2CqOc7XYRT

# Scheduled trigger
spec:
  trigger_metadata:
    source: schedule
    schedule_id: sched-daily-report
    cron: "0 9 * * *"
    timestamp: "2025-01-11T09:00:00Z"
```

### runtime_env

Execution-scoped environment variables. These override values from the WorkflowInstance's environments for this run only.

**Merge priority (highest to lowest):**
1. `runtime_env` (this field) — execution-specific overrides
2. Environment values (from `WorkflowInstance.environment_refs`, in order; a later ref wins)

The merged result is filtered to the keys declared in `Workflow.spec.env` — the workflow env map is a declaration whitelist (name + `is_secret` + `optional`), never a value source. Undeclared keys are dropped; a missing required key logs a warning but does not fail the run.

```yaml
spec:
  runtime_env:
    # Plain-text value
    CUSTOMER_EMAIL:
      value: john.doe@example.com
    # Reference to a Secret resource
    STRIPE_API_KEY:
      secret_ref: sec-stripe-prod
    # Dynamic per-execution config
    DEPLOYMENT_REGION:
      value: us-west-2
    ENABLE_BETA_FEATURES:
      value: "true"
```

Tasks access these values as `{{env.VARIABLE_NAME}}`.

### Async Token Handshake

`spec.callback_token` enables the Temporal async activity completion pattern for workflow-calling-workflow scenarios:

1. Parent workflow (caller) extracts its Temporal task token
2. Passes the token in `callback_token` when creating WorkflowExecution
3. Caller returns `activity.ErrResultPending` — worker thread released
4. Child workflow executes (potentially hours later)
5. Child workflow calls `ActivityCompletionClient.complete(token, result)`
6. Temporal resumes the paused parent activity with the result

When `callback_token` is empty, execution is fire-and-forget (normal API/CLI use case).

## Status Fields

`WorkflowExecutionStatus` is system-managed. Never set these fields when creating an execution.

| Field | Description |
|---|---|
| `status.phase` | Current lifecycle phase. See [Execution Lifecycle](execution-lifecycle.md). |
| `status.tasks` | List of workflow tasks with real-time execution state. Source of truth for progress. |
| `status.output` | Final workflow output (JSON). Only populated when `phase == EXECUTION_COMPLETED`. |
| `status.error` | Error description. Only populated when `phase == EXECUTION_FAILED`. |
| `status.started_at` | ISO 8601 timestamp when execution started (PENDING → IN_PROGRESS transition). |
| `status.completed_at` | ISO 8601 timestamp when execution reached a terminal state. |
| `status.temporal_workflow_id` | Correlation ID for the Temporal workflow engine. Useful for advanced debugging. |
| `status.pending_approvals` | Approval requests from child agent executions. See [HITL Approvals](hitl-approvals.md). |
| `status.audit` | Standard audit record: `created_at`, `updated_at`, `created_by`. |

### Progress Calculation

Progress is derived from `status.tasks` — no separate counter field needed:

```
total_tasks      = len(status.tasks)
completed_tasks  = count(tasks where status in [COMPLETED, FAILED, SKIPPED])
progress_percent = (completed_tasks / total_tasks) * 100
current_task     = tasks.find(status == IN_PROGRESS)
```

## Task Fields

Each entry in `status.tasks` is a `WorkflowTask` — the atomic unit of work in a workflow execution.

| Field | Description |
|---|---|
| `task_id` | Unique identifier within this execution. Format: `task-{number}` or a descriptive slug. |
| `task_name` | Human-readable task name. Example: `"Validate customer email"`. |
| `task_type` | Type of task. Determines execution behavior. See [Task Types](#task-types). |
| `status` | Current task status. See [Task Status](#task-status). |
| `input` | Task input parameters (JSON). Structure varies by `task_type`. |
| `output` | Task output results (JSON). Only populated when `status == WORKFLOW_TASK_COMPLETED`. |
| `error` | Error description. Only populated when `status == WORKFLOW_TASK_FAILED`. |
| `started_at` | ISO 8601 timestamp when task started (PENDING → IN_PROGRESS transition). |
| `completed_at` | ISO 8601 timestamp when task reached a terminal state. |
| `metadata` | Task-specific metadata (retry count, agent execution ID, response headers, approval history). |

### Task Types

| Type | Enum Value | Description |
|---|---|---|
| `WORKFLOW_TASK_AGENT_INVOCATION` | 1 | Invoke an AI AgentInstance with a prompt. Waits for agent execution to complete. |
| `WORKFLOW_TASK_APPROVAL` | 2 | Pause workflow and wait for human approval from designated approvers. |
| `WORKFLOW_TASK_API_CALL` | 3 | Make an HTTP or gRPC API call to an external service. |
| `WORKFLOW_TASK_CONDITIONAL` | 4 | Evaluate a boolean expression and branch to different task paths. |
| `WORKFLOW_TASK_PARALLEL` | 5 | Execute multiple sub-tasks concurrently and wait for all to complete. |
| `WORKFLOW_TASK_TRANSFORM` | 6 | Transform data between tasks (map, filter, aggregate, format). |
| `WORKFLOW_TASK_CUSTOM` | 7 | Custom task logic defined by plugins. |

### Task Status

| Status | Enum Value | Terminal? | Description |
|---|---|---|---|
| `WORKFLOW_TASK_PENDING` | 1 | No | Created, waiting for dependencies to complete. |
| `WORKFLOW_TASK_IN_PROGRESS` | 2 | No | Currently executing. |
| `WORKFLOW_TASK_COMPLETED` | 3 | **Yes** | Finished successfully. `output` is populated. |
| `WORKFLOW_TASK_FAILED` | 4 | **Yes** | Failed during execution. `error` is populated. |
| `WORKFLOW_TASK_SKIPPED` | 5 | **Yes** | Skipped by conditional logic. Not an error. Counts toward progress. |
| `WORKFLOW_TASK_WAITING_APPROVAL` | 6 | No | Paused — child agent invocation is waiting for HITL approval. |

### Task Input/Output by Type

**WORKFLOW_TASK_AGENT_INVOCATION:**

```yaml
input:
  agent_instance_id: agi-customer-support
  prompt: "Analyze this feedback: {{workflow.input.trigger_message}}"
  max_tokens: 500
output:
  agent_execution_id: agx-abc123
  response: "The customer feedback indicates overall satisfaction..."
  metadata:
    tokens_used: 450
    model: gpt-4o
```

**WORKFLOW_TASK_API_CALL:**

```yaml
input:
  method: POST
  url: https://api.stripe.com/v1/customers
  headers:
    Authorization: "Bearer {{env.STRIPE_API_KEY}}"
    Content-Type: application/json
  body:
    email: "{{workflow.input.email}}"
    name: "{{workflow.input.name}}"
  timeout_seconds: 30
output:
  status_code: 200
  body:
    id: cus-abc123
    email: customer@example.com
    created: 1704988800
```

**WORKFLOW_TASK_APPROVAL:**

```yaml
input:
  approvers:
    - usr-admin-1
    - usr-admin-2
  message: "Approve account creation for {{workflow.input.email}}?"
  timeout_hours: 24
  require_all_approvers: false
output:
  approved: true
  approved_by: usr-admin-1
  approved_at: "2025-01-11T15:22:33Z"
  comment: "Looks good, approved"
```

**WORKFLOW_TASK_CONDITIONAL:**

```yaml
input:
  condition: "{{tasks.validate_email.output.valid}} == true"
  if_true:
    - task-create-account
    - task-send-welcome
  if_false:
    - task-send-error-email
output:
  condition_result: true
  executed_branch: if_true
  executed_tasks:
    - task-create-account
    - task-send-welcome
```

**WORKFLOW_TASK_PARALLEL:**

```yaml
input:
  tasks:
    - task_id: send-email
      task_type: api_call
    - task_id: send-sms
      task_type: api_call
    - task_id: send-slack
      task_type: api_call
  wait_for_all: true
  fail_on_any_failure: false
output:
  total_tasks: 3
  successful_tasks: 2
  failed_tasks: 1
  results:
    - task_id: send-email
      status: completed
    - task_id: send-sms
      status: failed
      error: "SMS service unavailable"
    - task_id: send-slack
      status: completed
```

**WORKFLOW_TASK_TRANSFORM:**

```yaml
input:
  expression: "{{tasks.fetch_customers.output.customers | map('email')}}"
  output_variable: customer_emails
output:
  result:
    - customer1@example.com
    - customer2@example.com
    - customer3@example.com
```

## CLI Commands

```bash
# Trigger a workflow execution
stigmer run workflow customer-onboarding \
  --message "New signup: john.doe@example.com" \
  --env CUSTOMER_EMAIL=john.doe@example.com

# Trigger using a specific WorkflowInstance
stigmer run workflow-instance wfi-customer-onboarding-prod \
  --message "New signup: john.doe@example.com"

# Get execution details
stigmer get workflow-execution wfx-abc123xyz456
stigmer get workflow-execution wfx-abc123xyz456 --output yaml
stigmer get workflow-execution wfx-abc123xyz456 --output json

# List all executions (most recent first)
stigmer list workflow-executions

# List only in-progress executions
stigmer list workflow-executions --phase in_progress

# List only failed executions
stigmer list workflow-executions --phase failed

# List executions for a specific workflow
stigmer list workflow-executions --workflow customer-onboarding

# List executions for a specific WorkflowInstance
stigmer list workflow-executions --workflow-instance wfi-customer-onboarding-prod

# Watch real-time updates
stigmer watch workflow-execution wfx-abc123xyz456

# Cancel an execution gracefully
stigmer cancel workflow-execution wfx-abc123xyz456 \
  --reason "Customer cancelled their order"

# Terminate an execution immediately (use only for stuck workflows)
stigmer terminate workflow-execution wfx-abc123xyz456 \
  --reason "Workflow unresponsive for 2 hours"

# Recover a failed execution from last checkpoint
stigmer recover workflow-execution wfx-abc123xyz456 \
  --reason "External API recovered, resuming"

# Pause an execution
stigmer pause workflow-execution wfx-abc123xyz456 \
  --reason "Maintenance window starting"

# Resume a paused execution
stigmer resume workflow-execution wfx-abc123xyz456

# Send a signal to unblock a LISTEN task
stigmer signal workflow-execution wfx-abc123xyz456 \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_123", "amount": 99.99}'

# Delete a completed or failed execution
stigmer delete workflow-execution wfx-abc123xyz456
```

### Run Flags Reference

| Flag | Default | Description |
|---|---|---|
| `--message <text>` | — | Trigger message passed as `spec.trigger_message`. |
| `--env KEY=VALUE` | — | Runtime environment variable. Repeatable. Plain-text values only. |
| `--secret KEY=secret-ref` | — | Runtime secret reference. Repeatable. |
| `--workflow-instance <id>` | — | Target a specific WorkflowInstance by ID. |
| `--org <org>` | CLI context | Organization to run in. |
| `--dry-run` | `false` | Validate inputs without creating the execution. |
| `--watch` | `false` | Subscribe to live updates after creating the execution. |
| `--auto-approve` | `false` | Bypass all HITL approval gates for this execution. |

## Related Documentation

- [README.md](README.md) — Overview, trigger sources, and documentation index
- [execution-lifecycle.md](execution-lifecycle.md) — Phase state machine, lifecycle control operations
- [hitl-approvals.md](hitl-approvals.md) — Human-in-the-Loop approval forwarding
- [examples.md](examples.md) — Complete end-to-end examples
