# Workflow Task Reference

Complete reference for all 13 `WorkflowTaskKind` values. Each entry includes the task's purpose, required and optional fields, and a minimal YAML example.

For expression syntax used in task configs (`${ ... }`), see [expressions.md](expressions.md).

## Task Anatomy

Every task in `spec.tasks` has the same outer shape:

```yaml
- name: myTask              # required — unique within this workflow
  kind: http_call           # required — determines task_config schema
  task_config:              # required — task-specific fields (varies by kind)
    method: GET
    endpoint:
      uri: "https://api.example.com/data"
  export:                   # optional — save output to $context
    as: "${.}"
  flow:                     # optional — override sequential execution
    then: nextTask
```

`export` and `flow` are universal — they appear on every task kind in the same way.

---

## Quick Reference

| Kind | Description | Required Fields |
|---|---|---|
| [`set_vars`](#set_vars) | Assign variables to workflow context | `variables` |
| [`http_call`](#http_call) | Make HTTP requests | `method`, `endpoint.uri` |
| [`grpc_call`](#grpc_call) | Make gRPC requests | `service`, `method` |
| [`activity_call`](#activity_call) | Execute a Temporal activity | `activity` |
| [`switch_case`](#switch_case) | Conditional branching | `cases` (≥1) |
| [`for_each`](#for_each) | Iterate over a collection | `each`, `in`, `do` (≥1 task) |
| [`fork`](#fork) | Parallel execution | `branches` (≥2) |
| [`try_catch`](#try_catch) | Error handling | `try` (≥1 task) |
| [`listen`](#listen) | Wait for external signals | `to.mode`, `to.signals` (≥1) |
| [`wait`](#wait) | Delay/sleep | `duration` or `until` |
| [`raise_error`](#raise_error) | Raise an error and terminate | `error`, `message` |
| [`run_workflow`](#run_workflow) | Execute a sub-workflow | `workflow` |
| [`agent_call`](#agent_call) | Invoke an AI agent | `agent`, `message` |

---

## set_vars

Assigns one or more variables to the workflow context. Use this to compute, rename, or initialize values for use in subsequent tasks.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.SetTaskConfig`

| Field | Required | Description |
|---|---|---|
| `variables` | Yes | Map of variable name → value or expression. |

```yaml
- name: initVars
  kind: set_vars
  task_config:
    variables:
      status: "pending"
      startTime: "${now}"
      itemCount: "${$context.fetchItems.body | length}"
      greeting: "Hello, ${$context.user.name}!"
```

Variables set by `set_vars` are accessible via `${$context.varName}` in all subsequent tasks.

---

## http_call

Makes an HTTP request to an external endpoint. Supports GET, POST, PUT, DELETE, and PATCH.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.HttpCallTaskConfig`

| Field | Required | Description |
|---|---|---|
| `method` | Yes | HTTP method. One of: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`. |
| `endpoint.uri` | Yes | Request URL. Supports expressions: `"https://api.example.com/${.resource}"`. |
| `headers` | No | Map of header name → value. Supports expressions. |
| `body` | No | Request body as a JSON object. Supports expressions in string values. |
| `timeout_seconds` | No | Request timeout (1–300). Default: 30. |

```yaml
- name: fetchUser
  kind: http_call
  task_config:
    method: GET
    endpoint:
      uri: "https://api.acme.com/users/${$context.userId}"
    headers:
      Authorization: "Bearer ${.env.API_TOKEN}"
      Accept: "application/json"
  export:
    as: "${.body}"
  flow:
    then: processUser

- name: createRecord
  kind: http_call
  task_config:
    method: POST
    endpoint:
      uri: "https://api.acme.com/records"
    headers:
      Content-Type: "application/json"
      Authorization: "Bearer ${.env.API_TOKEN}"
    body:
      userId: "${$context.fetchUser.id}"
      timestamp: "${now}"
      data: "${$context.processUser.result}"
    timeout_seconds: 60
  export:
    as: "${.}"
```

---

## grpc_call

Makes a gRPC request to an external service.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.GrpcCallTaskConfig`

| Field | Required | Description |
|---|---|---|
| `service` | Yes | Fully qualified service name (e.g., `com.example.UserService`). |
| `method` | Yes | Method name to call (e.g., `GetUser`). |
| `request` | No | Request message as a JSON object matching the proto schema. |

```yaml
- name: lookupUser
  kind: grpc_call
  task_config:
    service: "com.acme.UserService"
    method: "GetUser"
    request:
      user_id: "${$context.userId}"
  export:
    as: "${.}"
  flow:
    then: processUser
```

---

## activity_call

Executes a registered Temporal activity. Use this to invoke platform-level infrastructure operations (e.g., sending emails, running database migrations) that are pre-registered in the workflow runner.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.CallActivityTaskConfig`

| Field | Required | Description |
|---|---|---|
| `activity` | Yes | Activity name. Must match a registered Temporal activity. |
| `input` | No | Activity input as a JSON object. Supports expressions. |

```yaml
- name: sendNotification
  kind: activity_call
  task_config:
    activity: "SendEmailActivity"
    input:
      to: "${$context.user.email}"
      subject: "Deployment complete"
      body: "Build ${$context.buildId} deployed successfully."
  flow:
    then: updateStatus
```

---

## switch_case

Evaluates an ordered list of conditions and jumps to the task matched by the first true case. Analogous to an `if-else if-else` chain.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.SwitchTaskConfig`

| Field | Required | Description |
|---|---|---|
| `cases` | Yes (≥1) | Ordered list of `SwitchCase` entries. |
| `cases[].name` | Yes | Case identifier. |
| `cases[].when` | No | JQ condition expression. If omitted, this is the default case. |
| `cases[].then` | Yes | Task name to jump to if this case matches. |

Cases are evaluated in order. The first case where `when` is true (or where `when` is absent) executes. If no case matches, the workflow continues to the next task.

```yaml
- name: routeByStatus
  kind: switch_case
  task_config:
    cases:
      - name: success
        when: "${$context.buildResult.status == \"success\"}"
        then: deployTask
      - name: flaky
        when: "${$context.buildResult.status == \"flaky\"}"
        then: retryTask
      - name: defaultFail
        then: notifyFailure
```

---

## for_each

Iterates over a collection, executing a sequence of tasks for each element.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.ForTaskConfig`

| Field | Required | Description |
|---|---|---|
| `each` | Yes | Variable name for the current iteration item. Accessible as `${$data.each}` inside loop tasks. |
| `in` | Yes | Expression that evaluates to the collection to iterate over. |
| `do` | Yes (≥1 task) | List of `WorkflowTask` entries to execute for each item. |

Inside loop tasks, two special context variables are available:
- `${$data.item}` — the current item (using the name you gave in `each`)
- `${$data.index}` — the 0-based index of the current item

```yaml
- name: processEachRepo
  kind: for_each
  task_config:
    each: repo
    in: "${$context.fetchRepos.body}"
    do:
      - name: analyzeRepo
        kind: agent_call
        task_config:
          agent: "code-analyzer"
          message: "Analyze repository: ${$data.repo.url}"
          env:
            GITHUB_TOKEN: "${.env.GITHUB_TOKEN}"
        export:
          as: "${.}"
```

---

## fork

Executes multiple branches in parallel. By default, all branches must complete before the workflow continues. In compete mode (`compete: true`), the first branch to complete wins and the others are cancelled.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.ForkTaskConfig`

| Field | Required | Description |
|---|---|---|
| `branches` | Yes (≥2) | List of `ForkBranch` entries to execute in parallel. |
| `branches[].name` | Yes | Branch identifier. |
| `branches[].do` | Yes (≥1 task) | Tasks to execute in this branch. |
| `compete` | No | If `true`, first branch to complete wins (race mode). Default: `false`. |

```yaml
- name: parallelChecks
  kind: fork
  task_config:
    compete: false
    branches:
      - name: securityScan
        do:
          - name: runSast
            kind: http_call
            task_config:
              method: POST
              endpoint:
                uri: "https://security.acme.com/scan"
              body:
                repo: "${$context.repoUrl}"
      - name: dependencyAudit
        do:
          - name: runAudit
            kind: activity_call
            task_config:
              activity: "DependencyAuditActivity"
              input:
                repo: "${$context.repoUrl}"
```

For compete (race) mode — wait for whichever approval channel responds first:

```yaml
- name: awaitApproval
  kind: fork
  task_config:
    compete: true
    branches:
      - name: slackApproval
        do:
          - name: waitForSlack
            kind: listen
            task_config:
              to:
                mode: one
                signals:
                  - id: slack_approval
                    type: signal
      - name: emailApproval
        do:
          - name: waitForEmail
            kind: listen
            task_config:
              to:
                mode: one
                signals:
                  - id: email_approval
                    type: signal
```

---

## try_catch

Wraps a sequence of tasks in error handling. If any task in the `try` block fails, execution jumps to the `catch` block. If no `catch` is defined, errors propagate to the parent.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.TryTaskConfig`

| Field | Required | Description |
|---|---|---|
| `try` | Yes (≥1 task) | Tasks to attempt. Failure in any task triggers the catch block. |
| `catch` | No | Error handling block. |
| `catch.as` | No | Variable name under which the error is stored. |
| `catch.do` | Yes if catch set (≥1 task) | Tasks to execute when an error is caught. |

The caught error is accessible in catch tasks via `${.errorName}` where `errorName` is the value of `catch.as`.

```yaml
- name: callExternalService
  kind: try_catch
  task_config:
    try:
      - name: makeRequest
        kind: http_call
        task_config:
          method: POST
          endpoint:
            uri: "https://flaky-api.example.com/data"
          timeout_seconds: 10
    catch:
      as: httpError
      do:
        - name: logFailure
          kind: activity_call
          task_config:
            activity: "LogErrorActivity"
            input:
              error: "${.httpError}"
              task: "callExternalService"
        - name: notifyTeam
          kind: http_call
          task_config:
            method: POST
            endpoint:
              uri: "https://hooks.slack.com/services/${.env.SLACK_WEBHOOK}"
            body:
              text: "External service call failed: ${.httpError.message}"
  flow:
    then: continueProcessing
```

---

## listen

Pauses workflow execution and waits for one or more external signals. Backed by Temporal signals/queries/updates. Use this for human-in-the-loop approvals, external event triggers, or integration handoffs.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.ListenTaskConfig`

| Field | Required | Description |
|---|---|---|
| `to.mode` | Yes | `"one"` — wait for any one signal; `"all"` — wait for all signals. |
| `to.signals` | Yes (≥1) | List of signals to listen for. |
| `to.signals[].id` | Yes | Signal identifier used when sending the signal externally. |
| `to.signals[].type` | Yes | Signal mechanism. One of: `"signal"`, `"query"`, `"update"`. |

```yaml
- name: waitForApproval
  kind: listen
  task_config:
    to:
      mode: one
      signals:
        - id: approval_granted
          type: signal
        - id: approval_rejected
          type: signal
  export:
    as: "${.}"
  flow:
    then: checkApprovalResult
```

To wait for all signals in a multi-step approval:

```yaml
- name: waitForAllApprovals
  kind: listen
  task_config:
    to:
      mode: all
      signals:
        - id: manager_approval
          type: signal
        - id: security_approval
          type: signal
        - id: legal_approval
          type: signal
```

---

## wait

Pauses workflow execution for a fixed duration or until a specific timestamp. Backed by Temporal timers — the workflow is durably suspended and resumed without holding resources.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.WaitTaskConfig`

Use either `duration` or `until` — not both.

**`duration` fields** (additive — `{ days: 1, hours: 12 }` = 36 hours total):

| Field | Type | Description |
|---|---|---|
| `duration.days` | uint32 | Number of days. |
| `duration.hours` | uint32 | Number of hours. |
| `duration.minutes` | uint32 | Number of minutes. |
| `duration.seconds` | uint32 | Number of seconds. |
| `duration.milliseconds` | uint32 | Number of milliseconds. |

At least one `duration` field must be non-zero.

**`until`**: An RFC 3339 timestamp. If the timestamp is in the past, the task completes immediately.

```yaml
# Wait 24 hours before sending a follow-up
- name: holdForOneDay
  kind: wait
  task_config:
    duration:
      days: 1
  flow:
    then: sendFollowUp

# Wait 2.5 hours
- name: shortDelay
  kind: wait
  task_config:
    duration:
      hours: 2
      minutes: 30

# Wait until a specific time (e.g., scheduled maintenance window)
- name: waitForMaintenanceWindow
  kind: wait
  task_config:
    until: "2026-03-01T02:00:00Z"
  flow:
    then: runMaintenance
```

---

## raise_error

Raises an error, terminating the current workflow execution path. Use this to signal explicit failure conditions — invalid input, precondition violations, or unrecoverable states. Raised errors propagate to the nearest enclosing `try_catch` block, or terminate the workflow if none exists.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.RaiseTaskConfig`

| Field | Required | Description |
|---|---|---|
| `error` | Yes | Error type/name string. Can be a literal or expression. |
| `message` | Yes | Human-readable error message. Supports expressions. |

```yaml
- name: validateInput
  kind: switch_case
  task_config:
    cases:
      - name: valid
        when: "${$context.input.userId != null and $context.input.userId != \"\"}"
        then: processUser
      - name: invalid
        then: rejectInvalidInput

- name: rejectInvalidInput
  kind: raise_error
  task_config:
    error: "ValidationError"
    message: "userId is required but was not provided"
```

---

## run_workflow

Executes another workflow as a child Temporal workflow. The parent workflow waits for the child to complete before continuing.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.RunTaskConfig`

| Field | Required | Description |
|---|---|---|
| `workflow` | Yes | Workflow name/slug to execute. Must be an existing workflow in the same org. |
| `input` | No | Input data to pass to the sub-workflow as JSON. Supports expressions. |

```yaml
- name: runOnboardingFlow
  kind: run_workflow
  task_config:
    workflow: "user-onboarding"
    input:
      userId: "${$context.newUser.id}"
      email: "${$context.newUser.email}"
      planTier: "${$context.subscription.tier}"
  export:
    as: "${.}"
  flow:
    then: sendWelcomeEmail
```

---

## agent_call

Invokes an AI agent as a task, delegating complex reasoning or tool use to a specialized agent. The workflow waits for the agent to complete its execution and exports the agent's response.

**Proto**: `ai.stigmer.agentic.workflow.v1.tasks.AgentCallTaskConfig`

| Field | Required | Description |
|---|---|---|
| `agent` | Yes | Agent reference. Format: `"slug"` (uses workflow's org) or `"org/slug"` (explicit org). |
| `message` | Yes | Instructions/prompt to send to the agent. Supports expressions. |
| `org` | No | Explicit org override for agent resolution. |
| `env` | No | Runtime environment variables to pass to the agent. Map of name → value or expression. |
| `config.model` | No | LLM model override (e.g., `"claude-3-5-sonnet"`). Uses agent default if not set. |
| `config.timeout` | No | Execution timeout in seconds (1–3600). Default: 300. |
| `config.temperature` | No | LLM sampling temperature (0.0–1.0). Default: 0.7. |
| `config.context_management` | No | Context summarization settings. See context management docs. |

```yaml
# Basic agent call — uses workflow's org
- name: analyzeCode
  kind: agent_call
  task_config:
    agent: "code-reviewer"
    message: "Review the following code for security issues:\n\n${$context.fetchCode.body}"
  export:
    as: "${.}"
  flow:
    then: publishReview

# Cross-org agent call with config overrides
- name: generateReport
  kind: agent_call
  task_config:
    agent: "stigmer/report-generator"
    message: "Generate a deployment report for build ${$context.buildId}. Data: ${$context.buildMetrics}"
    env:
      S3_BUCKET: "${.env.REPORTS_BUCKET}"
      AWS_REGION: "${.env.AWS_REGION}"
    config:
      model: "claude-3-5-sonnet"
      timeout: 600
      temperature: 0.3
  export:
    as: "${.response}"
```

The agent's response is available in `$context.taskName` after export.

---

## Related Documentation

- [expressions.md](expressions.md) — JQ expression syntax for all `${ }` values
- [workflow-resource-guide.md](workflow-resource-guide.md) — Full resource schema, `export`, `flow`, and `env_spec`
- [examples.md](examples.md) — Complete workflow YAML combining multiple task types
