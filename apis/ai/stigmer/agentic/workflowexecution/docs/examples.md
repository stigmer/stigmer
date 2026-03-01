# WorkflowExecution Examples

Complete examples from minimal workflow triggers to multi-task pipeline monitoring, HITL approval flows, and signal-driven executions.

---

## Example 1: Minimal Workflow Trigger

The simplest possible WorkflowExecution — trigger a workflow with no input message and let it run.

```bash
# Trigger using a workflow slug (resolves to default instance)
stigmer run workflow customer-onboarding
```

The resulting resource:

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowExecution
metadata:
  id: wfx-1a2b3c4d5e6f
  name: customer-onboarding-20250111-143022
  org: acme-corp
spec:
  workflow_id: wf-customer-onboarding
status:
  phase: EXECUTION_PENDING
  audit:
    created_at: "2025-01-11T14:30:22Z"
    created_by: usr-jane-admin
```

---

## Example 2: API-Triggered Customer Onboarding

A complete workflow execution triggered via API with a trigger message, metadata, and runtime environment overrides.

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowExecution
metadata:
  name: customer-onboarding-20250111-143022
  org: acme-corp
  tags:
    - environment:production
    - team:growth
spec:
  workflow_instance_id: wfi-customer-onboarding-prod
  trigger_message: "New signup: john.doe@example.com"
  trigger_metadata:
    source: api
    caller_id: usr-jane-admin
    ip_address: "203.0.113.42"
    timestamp: "2025-01-11T14:30:22Z"
  runtime_env:
    CUSTOMER_EMAIL:
      value: john.doe@example.com
    CUSTOMER_PLAN:
      value: pro
    STRIPE_API_KEY:
      secret_ref: sec-stripe-prod
```

Apply with:

```bash
stigmer apply workflow-execution.yaml
```

Or trigger directly:

```bash
stigmer run workflow customer-onboarding \
  --instance wfi-customer-onboarding-prod \
  --message "New signup: john.doe@example.com" \
  --env CUSTOMER_EMAIL=john.doe@example.com \
  --env CUSTOMER_PLAN=pro \
  --secret STRIPE_API_KEY=sec-stripe-prod \
  --watch
```

### Monitoring Progress

```bash
# Poll for status
stigmer get workflow-execution wfx-1a2b3c4d5e6f --output yaml

# Subscribe to live updates
stigmer watch workflow-execution wfx-1a2b3c4d5e6f
```

**Mid-execution state (task 1 complete, task 2 in progress):**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-1
      task_name: Validate customer email
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
        mx_records_found: true
      started_at: "2025-01-11T14:30:23Z"
      completed_at: "2025-01-11T14:30:23.450Z"
    - task_id: task-2
      task_name: Create Stripe customer
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_IN_PROGRESS
      input:
        method: POST
        url: https://api.stripe.com/v1/customers
        body:
          email: john.doe@example.com
          metadata:
            plan: pro
      started_at: "2025-01-11T14:30:24Z"
    - task_id: task-3
      task_name: Send welcome email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_PENDING
  started_at: "2025-01-11T14:30:22Z"
```

**Completed state:**

```yaml
status:
  phase: EXECUTION_COMPLETED
  tasks:
    - task_id: task-1
      status: WORKFLOW_TASK_COMPLETED
      output:
        valid: true
        domain: example.com
    - task_id: task-2
      status: WORKFLOW_TASK_COMPLETED
      output:
        status_code: 200
        body:
          id: cus-abc123
          email: john.doe@example.com
    - task_id: task-3
      status: WORKFLOW_TASK_COMPLETED
      output:
        status_code: 200
        body:
          message_id: msg-xyz789
          delivered: true
  output:
    customer_id: cus-abc123
    account_created: true
    welcome_email_sent: true
    trial_activated: true
    trial_expires_at: "2025-02-10T14:30:22Z"
  started_at: "2025-01-11T14:30:22Z"
  completed_at: "2025-01-11T14:30:35Z"
```

---

## Example 3: Webhook-Triggered Execution

A Stripe webhook fires when a payment succeeds, triggering a workflow to process the order.

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowExecution
metadata:
  name: order-fulfillment-20250111-143025
  org: acme-corp
spec:
  workflow_instance_id: wfi-order-fulfillment-prod
  trigger_message: '{"payment_intent_id": "pi_abc123", "amount": 9900, "currency": "usd", "customer_id": "cus-xyz789"}'
  trigger_metadata:
    source: webhook
    webhook_id: whk-stripe-payment-succeeded
    webhook_source: stripe.com
    event_type: payment_intent.succeeded
    event_id: evt_1NqZP92eZvKYlo2CqOc7XYRT
    timestamp: "2025-01-11T14:30:25Z"
  runtime_env:
    PAYMENT_INTENT_ID:
      value: pi_abc123
    ORDER_AMOUNT_CENTS:
      value: "9900"
    CUSTOMER_ID:
      value: cus-xyz789
```

---

## Example 4: Agent Invocation Task Monitoring

A workflow that invokes an agent for content analysis. Monitor the agent task's progress.

**Trigger:**

```bash
stigmer run workflow content-analysis \
  --message "Analyze Q4 customer feedback from Zendesk tickets" \
  --watch
```

**Mid-execution — agent task in progress:**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-1
      task_name: Fetch feedback from Zendesk
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_COMPLETED
      output:
        body:
          tickets:
            - id: 12345
              subject: "Product is amazing"
            - id: 12346
              subject: "Slow response times"
      started_at: "2025-01-11T14:30:23Z"
      completed_at: "2025-01-11T14:30:24Z"
    - task_id: task-2
      task_name: Analyze sentiment with AI
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_IN_PROGRESS
      input:
        agent_instance_id: agi-content-analyzer
        prompt: "Analyze sentiment of these 2 support tickets: ..."
      metadata:
        agent_execution_id: agx-analyzer-001
      started_at: "2025-01-11T14:30:25Z"
```

**Completed — agent task output:**

```yaml
    - task_id: task-2
      task_name: Analyze sentiment with AI
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_COMPLETED
      output:
        agent_execution_id: agx-analyzer-001
        response: "Overall sentiment is positive (72%). Key themes: product quality (positive), response time (negative)."
        sentiment_score: 0.72
        themes:
          - name: product_quality
            sentiment: positive
            count: 1
          - name: response_time
            sentiment: negative
            count: 1
      metadata:
        agent_execution_id: agx-analyzer-001
        tokens_used: 1240
        model: gpt-4o
      started_at: "2025-01-11T14:30:25Z"
      completed_at: "2025-01-11T14:31:05Z"
```

---

## Example 5: Conditional Branch Workflow

A workflow with conditional logic — branches differently based on email validation result.

**Execution where email is invalid:**

```yaml
status:
  phase: EXECUTION_COMPLETED
  tasks:
    - task_id: task-1
      task_name: Validate email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_COMPLETED
      output:
        valid: false
        reason: invalid_mx_records
    - task_id: task-2
      task_name: Route based on validation
      task_type: WORKFLOW_TASK_CONDITIONAL
      status: WORKFLOW_TASK_COMPLETED
      input:
        condition: "{{tasks.task-1.output.valid}} == true"
        if_true:
          - task-create-account
          - task-send-welcome
        if_false:
          - task-send-error-notification
      output:
        condition_result: false
        executed_branch: if_false
        executed_tasks:
          - task-send-error-notification
    - task_id: task-create-account
      task_name: Create account
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_SKIPPED   # skipped by conditional
    - task_id: task-send-welcome
      task_name: Send welcome email
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_SKIPPED   # skipped by conditional
    - task_id: task-send-error-notification
      task_name: Send error notification
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_COMPLETED
      output:
        status_code: 200
        body:
          delivered: true
```

---

## Example 6: Parallel Fan-Out Notifications

A workflow that sends notifications to multiple channels in parallel.

**Trigger:**

```bash
stigmer run workflow multi-channel-notify \
  --message "Order #12345 shipped" \
  --env ORDER_ID=12345 \
  --env CUSTOMER_EMAIL=customer@example.com \
  --env CUSTOMER_PHONE="+15555550100" \
  --env SLACK_CHANNEL="#ops-alerts"
```

**Mid-execution — parallel tasks running:**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-1
      task_name: Send notifications in parallel
      task_type: WORKFLOW_TASK_PARALLEL
      status: WORKFLOW_TASK_IN_PROGRESS
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
      started_at: "2025-01-11T14:30:23Z"
```

**Completed — all parallel results collected:**

```yaml
    - task_id: task-1
      task_name: Send notifications in parallel
      task_type: WORKFLOW_TASK_PARALLEL
      status: WORKFLOW_TASK_COMPLETED
      output:
        total_tasks: 3
        successful_tasks: 3
        failed_tasks: 0
        results:
          - task_id: send-email
            status: completed
            output:
              message_id: msg-email-abc
              delivered: true
          - task_id: send-sms
            status: completed
            output:
              message_id: msg-sms-def
              delivered: true
          - task_id: send-slack
            status: completed
            output:
              ok: true
              ts: "1704988800.123456"
      started_at: "2025-01-11T14:30:23Z"
      completed_at: "2025-01-11T14:30:26Z"
```

---

## Example 7: HITL Approval Flow

A deployment workflow that requires human approval before pushing to production.

**Trigger:**

```bash
stigmer run workflow deploy-to-production \
  --message "Deploy service v2.3.1 to prod" \
  --env SERVICE=payment-service \
  --env VERSION=v2.3.1 \
  --env TARGET_ENV=production \
  --watch
```

**State: task waiting for approval**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-1
      task_name: Run test suite
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_COMPLETED
      output:
        tests_passed: 247
        tests_failed: 0
        coverage: 94.2
    - task_id: task-2
      task_name: Invoke deployment agent
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_WAITING_APPROVAL
      metadata:
        agent_execution_id: agx-deployer-001
      started_at: "2025-01-11T14:31:00Z"
  pending_approvals:
    - tool_call_id: call_deploy_production
      tool_name: kubectl_apply
      message: "Apply deployment manifest for payment-service:v2.3.1 to cluster prod-us-east-1"
      args_preview: '{"manifest": "deployment.yaml", "cluster": "prod-us-east-1", "namespace": "payments"}'
      requested_at: "2025-01-11T14:31:15Z"
      child_agent_execution_id: agx-deployer-001
```

**Submit approval:**

```bash
stigmer workflow-execution approve wfx-1a2b3c4d5e6f \
  --tool-call-id call_deploy_production \
  --comment "Tests pass, staging deploy verified — approved for prod"
```

**After approval — task resumed:**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-2
      task_name: Invoke deployment agent
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_IN_PROGRESS    # back to in-progress
      started_at: "2025-01-11T14:31:00Z"
  pending_approvals: []    # cleared
```

---

## Example 8: Signal-Driven Order Workflow

A workflow that places an order and then waits for external payment confirmation via a signal before proceeding with fulfillment.

**Trigger:**

```bash
stigmer run workflow order-processing \
  --message '{"order_id": "ord-12345", "items": [...], "total": 99.99}' \
  --env ORDER_ID=ord-12345 \
  --watch
```

**State: waiting for payment signal**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-1
      task_name: Create order record
      task_type: WORKFLOW_TASK_API_CALL
      status: WORKFLOW_TASK_COMPLETED
      output:
        order_id: ord-12345
        status: pending_payment
    - task_id: task-2
      task_name: Wait for payment confirmation
      task_type: WORKFLOW_TASK_CUSTOM
      status: WORKFLOW_TASK_IN_PROGRESS
      # This is a LISTEN task — waiting for "payment_confirmed" signal
      started_at: "2025-01-11T14:30:25Z"
    - task_id: task-3
      task_name: Fulfill order
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_PENDING
```

**Stripe webhook fires — send signal to unblock:**

```bash
stigmer signal workflow-execution wfx-1a2b3c4d5e6f \
  --signal payment_confirmed \
  --payload '{"transaction_id": "txn_abc123", "amount": 9999, "currency": "usd"}' \
  --idempotency-key "stripe:evt_1NqZP92eZvKYlo2CqOc7XYRT"
```

**State: signal received, workflow continues**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-2
      task_name: Wait for payment confirmation
      task_type: WORKFLOW_TASK_CUSTOM
      status: WORKFLOW_TASK_COMPLETED
      output:
        signal_name: payment_confirmed
        payload:
          transaction_id: txn_abc123
          amount: 9999
          currency: usd
      completed_at: "2025-01-11T14:32:00Z"
    - task_id: task-3
      task_name: Fulfill order
      task_type: WORKFLOW_TASK_AGENT_INVOCATION
      status: WORKFLOW_TASK_IN_PROGRESS
      started_at: "2025-01-11T14:32:01Z"
```

---

## Example 9: Failure and Recovery

A workflow fails partway through. After fixing the root cause, recover from the last checkpoint.

**Failed state:**

```yaml
status:
  phase: EXECUTION_FAILED
  tasks:
    - task_id: task-1
      task_name: Validate data
      status: WORKFLOW_TASK_COMPLETED
    - task_id: task-2
      task_name: Call payment API
      status: WORKFLOW_TASK_FAILED
      error: "API call failed: 429 Too Many Requests. Retry after 60 seconds."
      started_at: "2025-01-11T14:30:25Z"
      completed_at: "2025-01-11T14:30:26Z"
    - task_id: task-3
      task_name: Send confirmation
      status: WORKFLOW_TASK_PENDING
  error: "Task 'call_payment_api' failed: API rate limit exceeded (429). Retry after 60 seconds."
  started_at: "2025-01-11T14:30:22Z"
  completed_at: "2025-01-11T14:30:26Z"
```

**After the rate limit has cleared — recover:**

```bash
stigmer recover workflow-execution wfx-1a2b3c4d5e6f \
  --reason "Payment API rate limit cleared, resuming"
```

**Recovered state — continues from task-2:**

```yaml
status:
  phase: EXECUTION_IN_PROGRESS
  tasks:
    - task_id: task-1
      status: WORKFLOW_TASK_COMPLETED  # preserved
    - task_id: task-2
      task_name: Call payment API
      status: WORKFLOW_TASK_IN_PROGRESS  # retrying
      started_at: "2025-01-11T14:32:00Z"  # new attempt
    - task_id: task-3
      status: WORKFLOW_TASK_PENDING
  # error and completed_at cleared
  started_at: "2025-01-11T14:30:22Z"
```

---

## Example 10: Workflow-Calling-Workflow (Async Token Handshake)

Workflow A completes a task and triggers Workflow B, waiting for B to finish before continuing.

**Workflow A creates Workflow B execution with a Temporal callback token:**

```yaml
# Created by Workflow A's activity, not by user YAML
api_version: agentic.stigmer.ai/v1
kind: WorkflowExecution
metadata:
  name: data-enrichment-20250111-143030
  org: acme-corp
spec:
  workflow_instance_id: wfi-data-enrichment-prod
  trigger_message: '{"customer_id": "cus-abc123", "source_execution_id": "wfx-parent-xyz"}'
  trigger_metadata:
    source: workflow_chain
    parent_workflow_execution_id: wfx-parent-xyz
    parent_workflow_id: wf-customer-onboarding
  callback_token: "<opaque-temporal-task-token-bytes>"
```

**What happens:**
1. Workflow A's activity extracts its Temporal task token
2. Creates `WorkflowExecution` for Workflow B with `callback_token` set
3. Activity returns `ErrResultPending` — Temporal releases the worker thread
4. Workflow B executes independently (minutes or hours later)
5. Workflow B completes and calls `ActivityCompletionClient.complete(token, result)`
6. Temporal resumes Workflow A's paused activity with Workflow B's output
7. Workflow A continues with the enriched data

---

## Example 11: Listing and Filtering Executions

**List all in-progress executions:**

```bash
stigmer list workflow-executions --phase in_progress
```

**List failed executions for a specific workflow in production:**

```bash
stigmer list workflow-executions \
  --workflow customer-onboarding \
  --phase failed \
  --tag environment:production
```

**List execution history for a specific WorkflowInstance:**

```bash
stigmer list workflow-executions \
  --workflow-instance wfi-customer-onboarding-prod
```

**Example response:**

```yaml
total_pages: 3
entries:
  - metadata:
      id: wfx-newest-abc
      name: customer-onboarding-20250111-143022
      created_at: "2025-01-11T14:30:22Z"
    status:
      phase: EXECUTION_COMPLETED
      started_at: "2025-01-11T14:30:22Z"
      completed_at: "2025-01-11T14:30:35Z"
  - metadata:
      id: wfx-previous-def
      name: customer-onboarding-20250111-103015
      created_at: "2025-01-11T10:30:15Z"
    status:
      phase: EXECUTION_FAILED
      error: "Task 'create_account' failed: API timeout"
      started_at: "2025-01-11T10:30:15Z"
      completed_at: "2025-01-11T10:30:45Z"
  - metadata:
      id: wfx-older-ghi
      name: customer-onboarding-20250110-220510
      created_at: "2025-01-10T22:05:10Z"
    status:
      phase: EXECUTION_COMPLETED
      started_at: "2025-01-10T22:05:10Z"
      completed_at: "2025-01-10T22:05:28Z"
```
