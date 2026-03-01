# What is a Workflow?

## One-Sentence Positioning

**A Workflow is a portable, versioned, declarative definition of a durable automation pipeline—the same way a GitHub Actions workflow file is a portable, versioned definition of a CI job.**

---

## Executive Summary

A Workflow is a Stigmer API resource that defines a sequence of tasks to execute in a deterministic, durable order. Tasks can make HTTP calls, call gRPC services, iterate over collections, branch on conditions, run in parallel, invoke Temporal activities, wait for human approval signals, and—critically—call AI agents as first-class steps in the pipeline.

Workflows are not agents. An agent *thinks*; a workflow *orchestrates*. Where an agent uses an LLM to decide what to do next, a workflow executes exactly the steps you declare, in exactly the order you specify. This makes workflows the right tool for automation that must be predictable, auditable, and reproducible: deployment pipelines, data processing jobs, approval sequences, and recurring business operations.

When you apply a Workflow, the platform validates its structure asynchronously using the CNCF Serverless Workflow DSL 1.0.0 and generates a Temporal workflow definition. Every execution is durable—if the server restarts mid-run, the workflow resumes from where it left off. Temporal timers back `wait` tasks, meaning a workflow can sleep for days or weeks without holding resources.

The Workflow is the *template*—the blueprint. You apply it once, then create Workflow Instances to bind environment variables and secrets. The same Workflow runs in local development and in production without changes to the spec.

---

## The Problem Workflows Solve

### Automation Pipelines Are Built the Wrong Way

Most teams automate multi-step processes with imperative scripts or ad-hoc job runners:

**Typical approach:**

```python
def deploy_service(build_id, environment):
    result = requests.post(CI_URL, json={"build_id": build_id})
    if result.json()["status"] != "success":
        notify_slack("Build failed")
        return

    time.sleep(30)  # wait for image push (hope 30s is enough)

    k8s_result = requests.post(K8S_URL, json={
        "build_id": build_id,
        "env": environment,
    })

    if environment == "production":
        send_approval_email(build_id)
        # How do we wait for the email reply?
        # The process is dead by the time the email comes back
```

This works for a demo. It breaks in production.

**What goes wrong:**

- The script is not durable. If the server restarts while waiting for the image push, the deployment is lost. You have no idea if the pipeline finished.
- The `time.sleep(30)` is a guess. It is wrong for slow builds and wasteful for fast ones. Real waits—"wait for human approval"—cannot be implemented with `sleep` at all.
- There is no retry logic. A transient network failure at step 3 of 10 means you restart from step 1 and pay the full cost again.
- There is no conditional routing. Adding "if the security scan fails, go to the rejection path" requires rewriting the control flow.
- The whole pipeline is a Python function. There is no way to inspect it while it's running, pause it mid-way, or audit what happened when something goes wrong at 3am.
- Sharing this automation with another team means copying the script. Improvements never propagate.

### The Hidden Cost of This Approach

These problems compound over time:

- **No durability**: A process restart loses all in-flight work. You never know if pipelines finished.
- **No observability**: When something fails, you have a traceback. You have no record of which step was running, what it had done, or what the intermediate state was.
- **No control**: You cannot pause a running pipeline to review its progress, inject an approval gate, or stop it gracefully.
- **No composition**: Every new pipeline starts from scratch. There is no library of reusable automation building blocks.
- **No portability**: A pipeline that works locally cannot be promoted to production without touching the implementation.

---

## The Stigmer Workflow

### Declare It. Apply It. Run It.

Stigmer gives automation pipelines the same treatment it gives AI agents: a declarative API resource with a standard structure, durable execution backed by Temporal, and runtime decoupled from definition.

**The same workflow YAML works everywhere:**

```bash
# Local development
stigmer apply workflow.yaml
stigmer apply workflow-instance.yaml
stigmer run workflow my-workflow

# Production — same YAML, cloud backend
stigmer apply workflow.yaml
stigmer apply workflow-instance.yaml
stigmer run workflow my-workflow
```

### What the YAML Looks Like

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: deploy-service
  org: acme-corp
  visibility: visibility_private
spec:
  description: "Build, scan, get approval, and deploy a microservice to production"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: deploy-service
    version: "1.0.0"

  env_spec:
    variables:
      - name: BUILD_ID
        required: true
      - name: APPROVER_EMAIL
        required: true
      - name: DEPLOY_API_URL
        required: true

  tasks:
    - name: runSecurityScan
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "https://security.acme.com/scans"
        body:
          buildId: "${.env.BUILD_ID}"
      export:
        as: "${.body}"
      flow:
        then: checkScanResult

    - name: checkScanResult
      kind: switch_case
      task_config:
        cases:
          - name: passed
            when: "${$context.runSecurityScan.passed == true}"
            then: requestApproval
          - name: failed
            then: notifyFailure

    - name: requestApproval
      kind: activity_call
      task_config:
        activity: "SendEmailActivity"
        input:
          to: "${.env.APPROVER_EMAIL}"
          subject: "Approval needed: deploy build ${.env.BUILD_ID}"
      flow:
        then: waitForApproval

    - name: waitForApproval
      kind: listen
      task_config:
        to:
          mode: one
          signals:
            - id: deploy_approved
              type: signal
            - id: deploy_rejected
              type: signal
      export:
        as: "${.}"
      flow:
        then: checkApproval

    - name: checkApproval
      kind: switch_case
      task_config:
        cases:
          - name: approved
            when: "${$context.waitForApproval.signal == \"deploy_approved\"}"
            then: deploy
          - name: rejected
            then: notifyRejected

    - name: deploy
      kind: agent_call
      task_config:
        agent: "k8s-deployer"
        message: "Deploy build ${.env.BUILD_ID} to production. Approved by: ${$context.waitForApproval.approver}"
        env:
          KUBECONFIG: "${.secrets.KUBECONFIG}"

    - name: notifyFailure
      kind: raise_error
      task_config:
        error: "SecurityScanFailed"
        message: "Build ${.env.BUILD_ID} failed security scan"

    - name: notifyRejected
      kind: raise_error
      task_config:
        error: "DeploymentRejected"
        message: "Deploy rejected by ${$context.waitForApproval.approver}"
```

Apply it. It validates. Run it. It is durable.

---

## Architecture: The Two Layers

A Workflow in Stigmer is a stack of two resources, each with a distinct responsibility.

```
Workflow ──► WorkflowInstance
```

| Layer | Analogy | What It Does |
|---|---|---|
| **Workflow** | GitHub Actions workflow file | Declares the pipeline structure—tasks, control flow, environment variable declarations. Immutable template. You author this in YAML. |
| **WorkflowInstance** | GitHub Actions run | Binds the Workflow to an environment—provides concrete values for environment variables and secrets. Every Workflow gets a default instance automatically. |

**Why this separation matters:**

You author the Workflow once. Then you can create multiple WorkflowInstances—one for a staging environment (pointing at staging APIs), one for production (pointing at production APIs), one for each customer (with their specific configuration). Same blueprint, different runtime bindings.

You never touch the Workflow YAML to change environment-specific values. That is what WorkflowInstance is for.

---

## The Four Building Blocks of a Workflow

### 1. Tasks

Tasks are the steps of the workflow. Each task has a `kind` that determines what it does, a `task_config` with the specific configuration for that kind, an optional `export` to save its output for downstream tasks, and an optional `flow` to override sequential execution.

```yaml
tasks:
  - name: fetchData
    kind: http_call
    task_config:
      method: GET
      endpoint:
        uri: "https://api.example.com/data"
    export:
      as: "${.body}"      # save response body to $context.fetchData
    flow:
      then: processData   # jump to specific task (default: next in list)
```

Stigmer supports 13 task types covering the full range of automation needs:

| Kind | What It Does |
|---|---|
| `set_vars` | Assign variables to workflow context |
| `http_call` | Make HTTP requests (GET, POST, PUT, DELETE, PATCH) |
| `grpc_call` | Call a gRPC service method |
| `activity_call` | Execute a registered Temporal activity |
| `switch_case` | Branch on conditions (if-else if-else) |
| `for_each` | Iterate over a collection |
| `fork` | Run multiple branches in parallel |
| `try_catch` | Error handling (try/catch block) |
| `listen` | Wait for external signals (human approval, events) |
| `wait` | Sleep for a duration or until a timestamp |
| `raise_error` | Raise an error and terminate the execution path |
| `run_workflow` | Execute a sub-workflow as a child |
| `agent_call` | Invoke an AI agent as a task |

### 2. Expressions

Any field that accepts dynamic values uses the `${ }` expression syntax—a JQ-based language that can access previous task output, environment variables, secrets, and loop variables.

```yaml
# Access previous task output
uri: "https://api.example.com/users/${$context.fetchUser.id}"

# Access environment variables
endpoint:
  uri: "${.env.API_BASE_URL}/orders"

# Access secrets
headers:
  Authorization: "Bearer ${.secrets.API_TOKEN}"

# Compute from context
message: "Found ${$context.results | length} items to process"

# Conditional (in switch_case)
when: "${$context.score > 80 and $context.status == \"active\"}"
```

Expressions are validated asynchronously after `stigmer apply`. The platform generates the Serverless Workflow DSL YAML and checks all expression syntax before marking the workflow as `VALID`.

### 3. Flow Control

By default, tasks execute sequentially: the second task in the list runs after the first, the third after the second, and so on. The last task terminates the workflow.

`flow.then` overrides this to jump to a named task or terminate explicitly:

```yaml
flow:
  then: specificTask   # jump to a named task
  # then: "end"       # terminate immediately
```

`switch_case` tasks provide multi-way branching. `fork` tasks run multiple paths in parallel and rejoin automatically. `for_each` tasks loop over collections. Together, these turn a flat list of tasks into a fully expressive control flow graph.

### 4. Environment Spec

`spec.env_spec` declares the environment variables your workflow needs. These are not hardcoded values—they are declarations of what the workflow requires. Concrete values are provided by the WorkflowInstance at execution time.

```yaml
spec:
  env_spec:
    variables:
      - name: API_BASE_URL
        required: true
      - name: RETRY_LIMIT
        required: false
        default: "3"
```

Declared variables are accessible in all task configs via `${.env.VARIABLE_NAME}`. If a required variable is not bound in the WorkflowInstance, execution fails immediately with a clear error—not silently mid-pipeline.

---

## Calling Agents from Workflows

The `agent_call` task kind is what makes workflows and agents composable. Workflows can delegate complex, open-ended reasoning to specialized AI agents as first-class steps—then continue with the agent's output.

```yaml
- name: analyzeIncident
  kind: agent_call
  task_config:
    agent: "incident-analyzer"
    message: "Analyze this incident report and suggest root cause: ${$context.fetchReport.body}"
    config:
      model: "claude-3-5-sonnet"
      timeout: 300
  export:
    as: "${.response}"
  flow:
    then: createTicket

- name: createTicket
  kind: http_call
  task_config:
    method: POST
    endpoint:
      uri: "${.env.JIRA_URL}/issues"
    body:
      summary: "Incident: ${$context.fetchReport.title}"
      description: "${$context.analyzeIncident}"
```

This pattern lets you build automation that is deterministic at the pipeline level—tasks always run in the declared order, with declared inputs and outputs—while delegating open-ended reasoning to agents where needed. The workflow controls the orchestration; agents handle the intelligence.

---

## Durable Execution

Workflows are executed by Temporal, which provides durability guarantees that no script or job runner can match:

**What durability means in practice:**

- **Server restarts**: If the server running your workflow crashes mid-step, Temporal restores the workflow from its event history. Execution continues from exactly where it stopped.
- **Long waits**: A `wait` task with `duration: { days: 7 }` does not hold a thread or a process for 7 days. Temporal records a timer in its event log and resumes the workflow when the timer fires. You can have thousands of workflows waiting in parallel.
- **External signals**: A `listen` task that waits for a human to click "Approve" in a UI can wait indefinitely—days, weeks—without consuming resources. When the signal arrives, Temporal delivers it to the workflow.
- **Step-level audit trail**: Temporal's event history records every task execution: when it started, what it received, what it returned, how long it took. This is the complete, tamper-proof audit log.

---

## Asynchronous Validation

When you apply a Workflow, the platform does not block to validate it. The resource is created immediately and a Temporal validation workflow runs in the background. Check the result:

```bash
stigmer apply workflow.yaml
# Output: workflow/deploy-service applied (state: PENDING)

# Poll until VALID or INVALID
stigmer get workflow deploy-service --output yaml | grep -A 5 serverless_workflow_validation
```

The validation status has four states:

| State | Meaning |
|---|---|
| `PENDING` | Validation triggered, not yet complete |
| `VALID` | Workflow structure is correct. Generated DSL YAML stored. Ready to execute. |
| `INVALID` | Structural errors found. Check `errors` field. Fix and re-apply. |
| `FAILED` | Validation system error (not a user error). Re-apply to retry. |

Errors are specific and actionable:

```
"Invalid expression syntax at task 'checkScanResult': unterminated string"
"Environment variable 'DEPLOY_API_URL' referenced but not declared in env_spec"
"Task 'notifyRejected' references flow.then 'missingTask' which does not exist"
```

A workflow in `INVALID` state cannot be executed. Always confirm `VALID` before creating a WorkflowInstance.

---

## How It Compares

| Without Stigmer Workflows | With Stigmer Workflows |
|---|---|
| Automation scripts die mid-run when the server restarts | Durable Temporal execution — resumes from last step automatically |
| `time.sleep()` for waits — wrong duration, dead when the process exits | Temporal timers — wait days or weeks, zero resources consumed |
| Human approval requires custom polling or external tools | `listen` task — workflow pauses for a signal, resumes on approval |
| Multi-step failure restarts from step 1 | Step-level event history — completed steps never re-run |
| Control flow written as imperative code — untestable, unreadable | Declarative YAML — explicit steps, readable flow, version-controlled |
| Environment-specific values hardcoded into scripts | WorkflowInstance separates config from definition |
| Sharing a pipeline means copying scripts | Reference a workflow by `org/slug` — improvements propagate |
| AI steps require bespoke integration code | `agent_call` task — invoke any agent with a message in two lines |
| No visibility into a running pipeline | Temporal event history — every step recorded, every output stored |

---

## Getting Started

```bash
# 1. Write a workflow YAML
cat > my-workflow.yaml << 'EOF'
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: my-workflow
  org: local
spec:
  document:
    dsl: "1.0.0"
    namespace: local
    name: my-workflow
    version: "1.0.0"
  tasks:
    - name: ping
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://httpbin.org/get"
      export:
        as: "${.body}"
EOF

# 2. Apply it
stigmer apply my-workflow.yaml

# 3. Wait for validation
stigmer get workflow my-workflow --output yaml | grep "state:"
# state: VALID

# 4. Run it (uses the default WorkflowInstance)
stigmer run workflow my-workflow

# 5. List your workflows
stigmer list workflows
```

---

## Further Reading

- [Workflow Resource Guide](../../apis/ai/stigmer/agentic/workflow/docs/workflow-resource-guide.md) — Complete field documentation, metadata, spec, status, and CLI reference
- [Task Reference](../../apis/ai/stigmer/agentic/workflow/docs/task-reference.md) — All 13 task types with schemas and YAML examples
- [Expression Syntax](../../apis/ai/stigmer/agentic/workflow/docs/expressions.md) — `${ }` notation, context variables, JQ patterns
- [Workflow Examples](../../apis/ai/stigmer/agentic/workflow/docs/examples.md) — Complete workflows from minimal to multi-agent pipelines
- [What is an Agent?](./what-is-agent.md) — How agents and workflows relate: agents think, workflows orchestrate
- [What is a Workflow Execution?](./what-is-workflow-execution.md) — The runtime record for a single workflow run — task progress, lifecycle control, signals
- [What is an Agent Execution?](./what-is-agent-execution.md) — The runtime record for agent invocations called from `agent_call` tasks
