# WorkflowRun API Resource Reference

Schema reference for the `agentic.stigmer.ai/v1` WorkflowRun resource. For conceptual overview and lifecycle, see [README.md](README.md).

## Resource Shape

A WorkflowRun resource as returned by `stigmer get workflow-run <id> --output yaml`:

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowRun
metadata:
  id: wfx-abc123xyz456
  name: customer-onboarding-20250111-143022
  org: acme-corp
spec:
  workflow_id: wfl_01customeronboarding
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
  phase: RUN_IN_PROGRESS
  workflow_version_hash: 3f9a1c...
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
        agent: account-creator
        prompt: "Create account for john.doe@example.com on plan=pro"
      started_at: "2025-01-11T14:30:24Z"
    - task_id: task-3
      task_name: send_welcome_email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_PENDING
  started_at: "2025-01-11T14:30:22Z"
  temporal_workflow_id: workflow-exec-wfx-abc123xyz456
  audit:
    created_at: "2025-01-11T14:30:22Z"
    updated_at: "2025-01-11T14:30:24Z"
    created_by: usr-jane-admin
```

## Top-Level Fields

| Field | Set By | Value |
|---|---|---|
| `api_version` | System | Always `agentic.stigmer.ai/v1` |
| `kind` | System | Always `WorkflowRun` |
| `metadata` | System + author | See [Metadata Fields](#metadata-fields) |
| `spec` | Author | See [Spec Fields](#spec-fields) |
| `status` | System-managed | See [Status Fields](#status-fields) |

## Metadata Fields

| Field | Description |
|---|---|
| `metadata.id` | System-generated unique identifier. Format: `wfx-{ulid}`. Example: `wfx-abc123xyz456`. |
| `metadata.name` | Display name. Typically `{workflow-slug}-{timestamp}`. Example: `prod-deploy-20250111-143022`. |
| `metadata.org` | Organization that owns this run. |
| `metadata.labels` | Key-value pairs. Common labels: `workflow_id`, `trigger_source`. |
| `metadata.tags` | String tags for filtering. Common tags: environment names, team names. |

## Spec Fields

`WorkflowRunSpec` is defined in `spec.proto`. The spec is **immutable after creation** — it represents the inputs for this specific run. To retry with different inputs, create a new WorkflowRun.

| Field | Required | Description |
|---|---|---|
| `spec.workflow_id` | Yes | ID of the Workflow to run (`wfl_...`). The caller needs `can_execute` on the workflow. The run is pinned to the workflow's current version at create. |
| `spec.trigger_message` | No | Input message or payload for the workflow. Accessible as `{{workflow.input.trigger_message}}` in task configs. |
| `spec.trigger_metadata` | No | Key-value metadata about who/what triggered this run. For audit and analytics — not visible to workflow logic. |
| `spec.runtime_env` | No | Run-scoped environment variables and secrets. Highest merge priority. |

Fields 1 (`workflow_instance_id`) and 7 (`callback_token`) are reserved.

### The workflow a run reads

A run names its workflow by id. At create the server pins the workflow's current version (`status.workflow_version_hash`), and every later read of the run's workflow reads that version: the runner's task list and each `agent_call` step's `environment_refs`. Saving the workflow while the run is in progress never changes a step of that run. A version covers the whole workflow spec except who can see the runs; a workflow saved before versioning has no pin, and its runs read the current definition.

Who can see the run is the workflow's `spec.run_visibility`: the person who started it (the default), or every member of the organization when the workflow's owner has set it to `workflow_run_visibility_organization`.

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

Run-scoped environment variables, for this run only.

**Where a run's values come from:**
1. `runtime_env` (this field)
2. The keys declared in `Workflow.spec.env` decide what the run receives: the workflow env map is a declaration whitelist (name + `is_secret` + `optional`), never a value source. Undeclared keys are dropped.
3. Every declared key still missing is read from the personal environment of the person who started the run, when the workflow belongs to the run's organization. A workflow of another organization reads no one's personal environment.

A missing required key logs a warning but does not fail the run. A key the whole team uses has no shared binding for workflow runs: each person keeps it in their own personal environment or passes it here. An `agent_call` step's own `environment_refs` supply the keys its agent declares.

```yaml
spec:
  runtime_env:
    # Plain-text value
    CUSTOMER_EMAIL:
      value: john.doe@example.com
    # Reference to a Secret resource
    STRIPE_API_KEY:
      secret_ref: sec-stripe-prod
    # Dynamic per-run config
    DEPLOYMENT_REGION:
      value: us-west-2
    ENABLE_BETA_FEATURES:
      value: "true"
```

Tasks access these values as `{{env.VARIABLE_NAME}}`.

## Status Fields

`WorkflowRunStatus` is system-managed. Never set these fields when creating a run.

| Field | Description |
|---|---|
| `status.phase` | Current lifecycle phase. See [Run Lifecycle](run-lifecycle.md). |
| `status.tasks` | List of workflow tasks with real-time execution state. Source of truth for progress. |
| `status.output` | Final workflow output (JSON). Only populated when `phase == RUN_COMPLETED`. |
| `status.error` | Error description. Only populated when `phase == RUN_FAILED`. |
| `status.started_at` | ISO 8601 timestamp when the run started (PENDING → IN_PROGRESS transition). |
| `status.completed_at` | ISO 8601 timestamp when the run reached a terminal state. |
| `status.workflow_version_hash` | The workflow version this run was pinned to at create. Empty for a workflow saved before versioning. |
| `status.temporal_workflow_id` | Correlation ID for the Temporal workflow engine. Useful for advanced debugging. |
| `status.pending_approvals` | Approval requests from child agent runs. See [HITL Approvals](hitl-approvals.md). |
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

Each entry in `status.tasks` is a `WorkflowTask` — the atomic unit of work in a workflow run.

| Field | Description |
|---|---|
| `task_id` | Unique identifier within this run. Format: `task-{number}` or a descriptive slug. |
| `task_name` | Human-readable task name. Example: `"Validate customer email"`. |
| `task_type` | Type of task. Determines execution behavior. See [Task Types](#task-types). |
| `status` | Current task status. See [Task Status](#task-status). |
| `input` | Task input parameters (JSON). Structure varies by `task_type`. |
| `output` | Task output results (JSON). Only populated when `status == WORKFLOW_TASK_COMPLETED`. |
| `error` | Error description. Only populated when `status == WORKFLOW_TASK_FAILED`. |
| `started_at` | ISO 8601 timestamp when task started (PENDING → IN_PROGRESS transition). |
| `completed_at` | ISO 8601 timestamp when task reached a terminal state. |
| `metadata` | Task-specific metadata (retry count, agent run ID, response headers, approval history). |

### Task Types

| Type | Enum Value | Description |
|---|---|---|
| `WORKFLOW_TASK_AGENT_INVOCATION` | 1 | Invoke an Agent with a prompt, in a new session on the agent the task names. Waits for agent run to complete. |
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
  agent: customer-support
  prompt: "Analyze this feedback: {{workflow.input.trigger_message}}"
  max_tokens: 500
output:
  agent_run_id: agx-abc123
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
# Trigger a workflow run
stigmer run workflow customer-onboarding \
  --message "New signup: john.doe@example.com" \
  --env CUSTOMER_EMAIL=john.doe@example.com

# Get the run details
stigmer get workflow-run wfx-abc123xyz456
stigmer get workflow-run wfx-abc123xyz456 --output yaml
stigmer get workflow-run wfx-abc123xyz456 --output json

# List all runs (most recent first)
stigmer list workflow-runs

# List only in-progress runs
stigmer list workflow-runs --phase in_progress

# List only failed runs
stigmer list workflow-runs --phase failed

# List runs for a specific workflow
stigmer list workflow-runs --workflow customer-onboarding

# Watch real-time updates
stigmer watch workflow-run wfx-abc123xyz456

# Cancel a run gracefully
stigmer cancel workflow-run wfx-abc123xyz456 \
  --reason "Customer cancelled their order"

# Terminate a run immediately (use only for stuck workflows)
stigmer terminate workflow-run wfx-abc123xyz456 \
  --reason "Workflow unresponsive for 2 hours"

# Recover a failed run from last checkpoint
stigmer recover workflow-run wfx-abc123xyz456 \
  --reason "External API recovered, resuming"

# Pause a run
stigmer pause workflow-run wfx-abc123xyz456 \
  --reason "Maintenance window starting"

# Resume a paused run
stigmer resume workflow-run wfx-abc123xyz456

# Send a signal to unblock a LISTEN task
stigmer signal workflow-run wfx-abc123xyz456 \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_123", "amount": 99.99}'

# Delete a completed or failed run
stigmer delete workflow-run wfx-abc123xyz456
```

### Run Flags Reference

| Flag | Default | Description |
|---|---|---|
| `--message <text>` | — | Trigger message passed as `spec.trigger_message`. |
| `--env KEY=VALUE` | — | Runtime environment variable. Repeatable. Plain-text values only. |
| `--secret KEY=secret-ref` | — | Runtime secret reference. Repeatable. |
| `--org <org>` | CLI context | Organization to run in. |
| `--dry-run` | `false` | Validate inputs without creating the run. |
| `--watch` | `false` | Subscribe to live updates after creating the run. |
| `--auto-approve` | `false` | Bypass all HITL approval gates for this run. |

## Related Documentation

- [README.md](README.md) — Overview, trigger sources, and documentation index
- [run-lifecycle.md](run-lifecycle.md) — Phase state machine, lifecycle control operations
- [hitl-approvals.md](hitl-approvals.md) — Human-in-the-Loop approval forwarding
- [examples.md](examples.md) — Complete end-to-end examples
