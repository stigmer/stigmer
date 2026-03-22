# What is Workflow Runner?

## One-Sentence Positioning

**Workflow Runner is the execution engine that takes a WorkflowExecution record and turns it into a live CNCF Serverless Workflow run—stepping through every HTTP call, gRPC call, agent invocation, and control-flow task until the workflow reaches its final state.**

---

## Executive Summary

Workflow Runner is a Go background service, not an API resource. It is a [Temporal](https://temporal.io/) worker that bridges the Stigmer backend (which manages `Workflow` and `WorkflowExecution` resources) and a CNCF Serverless Workflow interpreter called Zigflow.

When a user triggers a workflow—via the CLI, the API, or an event—the Stigmer backend creates a `WorkflowExecution` record and enqueues a Temporal workflow. Workflow Runner picks up that job, fetches the `Workflow` YAML spec from the backend, interprets each task (HTTP call, gRPC call, agent invocation, shell script, conditional branch, loop), streams progress updates back to the backend, and handles large intermediate payloads transparently via the Claim Check pattern.

If you are working on Stigmer and you want to understand how workflows actually run step by step, Workflow Runner is where to look.

---

## Workflow Runner vs. Agent Runner

These two services are often mentioned together because they both execute things triggered by users and both follow the same polyglot Temporal pattern. They are, however, fundamentally different:

| | Agent Runner | Workflow Runner |
|---|---|---|
| **What it executes** | `AgentExecution` — an AI agent run driven by an LLM | `WorkflowExecution` — a deterministic, declarative workflow |
| **Language** | Python | Go |
| **Execution model** | LangGraph state machine with LLM calls and MCP tool use | CNCF Serverless Workflow interpreter (Zigflow) |
| **Task types** | LLM messages, tool calls, sub-agent delegation | HTTP, gRPC, agent calls, shell scripts, control flow |
| **State persistence** | LangGraph checkpointer (SQLite / MongoDB) | Temporal workflow state + Claim Check for large payloads |
| **Queue architecture** | Single queue | Three queues (orchestration, execution, validation) |
| **Workspace** | Provisions Git repos and sandboxes | Runtime environment variables only |

The simplest mental model: **Agent Runner runs AI.** **Workflow Runner runs code.**

A workflow can *call* an agent as one of its tasks—meaning Workflow Runner and Agent Runner work together for AI-powered automation pipelines.

---

## Where Workflow Runner Fits in the System

```
User (CLI / API / Event)
      │
      ▼
stigmer-service ──────────► Temporal Workflow (Java)
(gRPC / REST)                        │
      ▲                              │  schedules activities on:
      │                              │  "workflow_execution_runner"
      │                              ▼
      │                   Workflow Runner (Go) — Orchestration Worker
      │                              │
      │                              │  starts sub-workflow on:
      │                              │  "zigflow_execution"
      │                              ▼
      │                   Workflow Runner (Go) — Execution Worker
      │                              │
      │                   ┌──────────┴──────────┐
      │                   │  Zigflow Task Loop   │
      │                   │  HTTP / gRPC /       │
      │                   │  CallAgent / Run /   │
      │                   │  Switch / For /      │
      │                   │  Parallel / Set ...  │
      │                   └──────────┬──────────┘
      │                              │
      └──────────── progressive status updates (gRPC)
```

Like Agent Runner, Workflow Runner uses a **polyglot Temporal pattern**: Java handles the durable workflow orchestration and resource lifecycle; Go handles the actual workflow interpretation. This keeps the Stigmer backend's orchestration layer reliable and observable while the Workflow Runner can use Go's concurrency model and the Zigflow CNCF interpreter.

---

## The Three-Queue Architecture

Workflow Runner registers workers on three separate Temporal task queues. This separation prevents slow validation or large execution jobs from blocking fast orchestration tasks.

| Queue | Environment Variable | Worker Role |
|---|---|---|
| `workflow_execution_runner` | `TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE` | Orchestration: fetches resources, resolves environment, starts the execution sub-workflow |
| `zigflow_execution` | `TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE` | Execution: runs the Zigflow interpreter and all task activities |
| `workflow_validation_runner` | `TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE` | Validation: validates a workflow spec before it is saved or triggered |

---

## Key Components

### Temporal Worker (`worker/worker.go`)

The entry point for the service. It:
- Connects to the Temporal server
- Initializes the Claim Check manager (for large payloads)
- Creates three separate Temporal workers on the three queues above
- Registers activities on each worker
- Blocks until a shutdown signal

### Execute Workflow Activity (`worker/activities/execute_workflow_activity.go`)

The orchestration-level activity, called from the Java Temporal workflow. It is responsible for fetching everything needed and handing off to the execution layer:

```
Step 1  Query WorkflowExecution record from stigmer-service (gRPC)
Step 2  Query WorkflowInstance (from execution or by workflow_id)
Step 3  Query Workflow template (the YAML spec)
Step 4  Convert WorkflowSpec proto → YAML using the proto-to-yaml converter
Step 5  Resolve runtime environment (from ExecutionContext or execution.spec.runtime_env)
Step 6  Start ExecuteServerlessWorkflow on the "zigflow_execution" queue
Step 7  Wait for completion, then update execution status via gRPC
```

This activity runs on the orchestration queue and does no AI or task execution itself—its sole job is resource resolution and sub-workflow dispatch.

### Execute Serverless Workflow (`pkg/executor/temporal_workflow.go`)

The core Temporal workflow that runs on the execution queue. It drives the Zigflow interpreter:

```
Step 1  Parse workflow YAML → workflow definition (via zigflow.LoadFromString)
Step 2  Initialize state with InitialData and EnvVars
Step 3  Build task executor from the workflow's task list (tasks.NewDoTaskBuilder)
Step 4  Execute tasks one by one (sequentially or in parallel per the spec)
Step 5  Apply Claim Check on large intermediate results if enabled
Step 6  Return final result and state to the orchestration layer
```

Because this is a Temporal workflow (not just an activity), it is durable—a crash mid-execution will resume from the last completed task when the worker restarts.

### Zigflow Task Builders (`pkg/zigflow/tasks/`)

Zigflow is Stigmer's Go implementation of the [CNCF Serverless Workflow](https://serverlessworkflow.io/) specification. Each task type in a workflow YAML maps to a task builder:

| Task Type | Builder | What It Does |
|---|---|---|
| `call: http` | `task_builder_call_http.go` | Makes an HTTP request to an external endpoint |
| `call: grpc` | `task_builder_call_grpc.go` | Makes a gRPC call to an external service |
| `call: agent` | `task_builder_call_agent.go` | Triggers an agent execution via Agent Runner |
| `run` | `task_builder_run.go` | Runs a shell script or subprocess |
| `switch` | `task_builder_switch.go` | Conditional branching based on runtime state |
| `for` | `task_builder_for.go` | Iterates over a list of items |
| `parallel` | `task_builder_parallel.go` | Executes multiple branches concurrently |
| `set` | `task_builder_set.go` | Sets variables in the workflow state |
| `wait` | `task_builder_wait.go` | Pauses execution for a duration or until an event |

Every task builder implements the `TaskBuilder` interface, which means the execution loop is uniform regardless of what the task actually does.

### Claim Check Manager (`pkg/claimcheck/manager.go`)

Temporal imposes payload size limits. Workflow tasks can produce large results (e.g., an agent that returns a long document, or an HTTP call that returns a large JSON body). The Claim Check pattern handles this transparently:

1. If a result exceeds the threshold (default: **50 KB**), it is gzip-compressed and uploaded to Cloudflare R2.
2. A lightweight reference token replaces the full payload in the Temporal history.
3. When a downstream task needs the value, the manager fetches and decompresses it automatically.

This is invisible to the workflow author—the YAML does not need to do anything special. It is purely an infrastructure concern.

### Progress Interceptor (`pkg/interceptors/progress_interceptor.go`)

A Temporal activity interceptor that automatically sends a status update to `stigmer-service` after every activity completes. This is how Workflow Runner delivers live progress without requiring each task builder to manually call the gRPC endpoint. The interceptor:
- Wraps every activity execution
- On completion (success or failure), calls `WorkflowExecutionClient.UpdateStatus()` with the latest state
- Keeps the `WorkflowExecution` record in the backend current throughout the run

---

## End-to-End Execution Flow

Here is what happens from the moment a user triggers a workflow to when it finishes:

```
1. Java Workflow (stigmer-service) receives the trigger
   └─► Schedules ExecuteWorkflowActivity on "workflow_execution_runner"

2. ExecuteWorkflowActivity (Go, orchestration worker)
   ├─► Queries WorkflowExecution (gRPC → stigmer-service)
   ├─► Queries WorkflowInstance → Workflow (gRPC → stigmer-service)
   ├─► Converts WorkflowSpec proto → YAML
   ├─► Resolves runtime environment (merges env chain)
   └─► Starts ExecuteServerlessWorkflow on "zigflow_execution"

3. ExecuteServerlessWorkflow (Go, Temporal workflow, execution worker)
   ├─► Parses YAML workflow definition
   ├─► Initialises state with input data and env vars
   └─► Enters task loop:
       ├─► CallHTTP → fires HTTP activity, waits for response
       ├─► CallGRPC → fires gRPC activity, waits for response
       ├─► CallAgent → triggers AgentExecution in Agent Runner, waits
       ├─► Run      → executes shell command, captures stdout/stderr
       ├─► Switch   → evaluates condition, branches to matching path
       ├─► For      → iterates items, executes body per item
       ├─► Parallel → fans out tasks, waits for all to complete
       ├─► Set      → mutates workflow state variables
       └─► Wait     → sleeps for duration or awaits signal

4. Progress Interceptor (after every activity)
   └─► Sends UpdateStatus (gRPC) → stigmer-service

5. Claim Check (when results are large)
   └─► Compresses → uploads to R2 → replaces with reference token

6. Completion
   └─► ExecuteServerlessWorkflow returns final result and state
   └─► ExecuteWorkflowActivity writes terminal status to stigmer-service
```

---

## What a Workflow YAML Looks Like

Workflows are authored in CNCF Serverless Workflow YAML and stored as `Workflow` resources in Stigmer. A simple example:

```yaml
document:
  dsl: "1.0.0-alpha5"
  namespace: acme-corp
  name: deploy-and-notify
  version: "1.0.0"

input:
  schema:
    type: object
    properties:
      repo: { type: string }
      environment: { type: string }

do:
  - validate:
      call: http
      with:
        method: GET
        endpoint:
          uri: "https://api.acme.com/environments/${.environment}"
        headers:
          Authorization: "Bearer ${ENV.ACME_API_KEY}"
      output:
        as: .validation_result

  - deploy:
      call: agent
      with:
        agent: acme-corp/deploy-bot
        message: "Deploy ${.repo} to ${.environment}"
      output:
        as: .deploy_result

  - notify:
      call: http
      with:
        method: POST
        endpoint:
          uri: "https://hooks.slack.com/services/${ENV.SLACK_WEBHOOK}"
        body:
          text: "Deployed ${.repo} to ${.environment}: ${.deploy_result.summary}"
```

Each `do` item maps to a task builder. The `call: agent` task is how Workflow Runner invokes Agent Runner—passing the agent slug and a message, then blocking until the agent execution completes.

---

## Configuration Reference

Key environment variables:

| Variable | Description | Default |
|---|---|---|
| `TEMPORAL_SERVICE_ADDRESS` | Temporal server address | `localhost:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `default` |
| `TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE` | Orchestration queue name | `workflow_execution_runner` |
| `TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE` | Execution queue name | `zigflow_execution` |
| `TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE` | Validation queue name | `workflow_validation_runner` |
| `TEMPORAL_MAX_CONCURRENCY` | Max concurrent activities per worker | — |
| `STIGMER_BACKEND_ENDPOINT` | gRPC endpoint for stigmer-service | `localhost:8080` |
| `STIGMER_API_KEY` | Auth key for gRPC calls | required |
| `STIGMER_SERVICE_USE_TLS` | Whether to use TLS for gRPC | `false` |
| `CLAIMCHECK_ENABLED` | Enable Claim Check for large payloads | `false` |
| `CLAIMCHECK_THRESHOLD_BYTES` | Payload size threshold before offloading | `51200` (50 KB) |
| `CLAIMCHECK_COMPRESSION_ENABLED` | Gzip compress before uploading | `true` |
| `CLAIMCHECK_TTL_DAYS` | Days before uploaded artifacts expire | — |
| `R2_BUCKET` | Cloudflare R2 bucket name | — |
| `R2_ENDPOINT` | Cloudflare R2 endpoint URL | — |
| `R2_ACCESS_KEY_ID` | R2 access key | — |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | — |

---

## How It Fits With the Workflow Resource Stack

Workflow Runner does not define resources—it executes them. Every resource in the Workflow stack maps to something Workflow Runner does:

| API Resource | What Workflow Runner Does With It |
|---|---|
| `Workflow` | Reads the `spec` (task definitions, input schema, variables); converts it from proto to YAML for the Zigflow interpreter |
| `WorkflowInstance` | Reads environment bindings and default input; resolves to which `Workflow` template to run |
| `WorkflowExecution` | The top-level trigger; its ID drives the entire execution; Workflow Runner writes progressive status updates back to it |

---

## Running Workflow Runner Locally

```bash
cd backend/services/workflow-runner

# Install Go dependencies
go mod download

# Configure (requires Temporal server and stigmer-service)
export STIGMER_BACKEND_ENDPOINT=localhost:50051
export TEMPORAL_SERVICE_ADDRESS=localhost:7233

# Start the worker
go run main.go
```

For a full local stack, use the `docker-compose.yml` at the repo root. Workflow Runner, Temporal, stigmer-service, and all dependencies are wired together.

---

## Further Reading

- [What is a Workflow?](what-is-workflow.md) — The API resource that Workflow Runner executes
- [What is a Workflow Execution?](what-is-workflow-execution.md) — The runtime record Workflow Runner updates
- [What is Agent Runner?](what-is-agent-runner.md) — The sibling service for AI agent executions
- [CNCF Serverless Workflow Specification](https://serverlessworkflow.io/) — The open standard Zigflow implements
- [Workflow Runner source](../../backend/services/workflow-runner/) — The implementation
