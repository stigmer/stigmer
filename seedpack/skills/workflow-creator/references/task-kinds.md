# Task Kinds Reference

Stigmer workflows are built from **19 task kinds**. This file is a quick
orientation to what each kind is for and when to reach for it. It is **not** the
authoritative schema — always call `get_task_kind(kind="<kind>")` (or
`get_task_kind_registry` for all of them) to get the exact, current field schema,
JSON Schema, and examples before writing a task's `task_config`.

Use the exact YAML `kind` names below. An unknown kind fails validation.

## Quick selection guide

| Need to... | Use kind |
|---|---|
| Call an LLM with a prompt | `llm_call` |
| Run a Stigmer agent (with its tools and skills) | `agent_call` |
| Pause for human review/approval | `human_input` |
| Branch on a condition | `switch_case` |
| Reshape / merge / extract data (JQ) | `transform` |
| Run several branches in parallel | `fork` |
| Loop over a collection | `for_each` |
| Set / compute variables | `set_vars` |
| Validate data against a schema | `validate` |
| Call an HTTP endpoint | `http_call` |
| Call a gRPC endpoint | `grpc_call` |
| Call a registered activity | `activity_call` |
| Run another workflow as a sub-workflow | `run_workflow` |
| Handle recoverable failures | `try_catch` |
| Raise an explicit error | `raise_error` |
| Wait for an external event | `listen` |
| Pause for a fixed duration | `wait` |
| Emit a domain event | `emit_event` |
| Send a notification | `notification` |

## The 19 kinds

### Agent & model tasks

- **`llm_call`** — Invoke a model directly with `system_prompt` + `prompt`. Supports
  `model`, `temperature`, `max_tokens`, `timeout`, `max_retries`, and
  `response_schema` (with `on_invalid` / `max_retries`) for structured JSON output.
- **`agent_call`** — Run a defined Stigmer agent by slug, passing a `message`. The
  agent brings its own MCP tools and skills. Supports `harness`, an `output.schema`
  with `on_invalid`/`max_retries` for structured results, and a `run_config` block
  (`model_name`, `max_cost_usd`, `max_tool_rounds`) for per-call model choice and
  enforced run bounds.

### Control flow

- **`switch_case`** — Route to different tasks based on `when` conditions. Each case
  has a `name`, optional `when` expression, and a `then` target. A case without
  `when` is the default.
- **`fork`** — Run multiple `branches` in parallel; each branch has a `name` and a
  `do` list of tasks. `compete: false` waits for all branches; `compete: true`
  takes the first to finish.
- **`for_each`** — Iterate over a collection, running a sub-task body per item.
- **`try_catch`** — Run a body and catch failures, routing to a recovery path.
- **`raise_error`** — Stop the workflow (or branch) with an explicit error.
- **`wait`** — Pause for a fixed duration.
- **`listen`** — Block until a matching external event arrives.

### Data tasks

- **`set_vars`** — Assign or compute variables for downstream use.
- **`transform`** — Reshape/merge/extract data. Use `engine: TRANSFORM_ENGINE_JQ`
  with a JQ `expression` operating on the object supplied via `input`.
- **`validate`** — Check data against a schema and fail/branch on mismatch.

### Human-in-the-loop

- **`human_input`** — Present a `prompt`, optional `form_schema`, and a set of
  `outcomes` (each with `name`, `label`, and optional `then`). Supports `approvers`,
  `timeout`, and `on_timeout`. This is the standard approval-gate kind.

### Integration tasks

- **`http_call`** — Make an HTTP request to an external endpoint.
- **`grpc_call`** — Make a gRPC call to an external service.
- **`activity_call`** — Invoke a registered platform activity.
- **`run_workflow`** — Execute another workflow as a child workflow.

### Eventing & messaging

- **`emit_event`** — Emit a structured domain event (type, subject, data). Often
  used as a terminal step to signal an outcome (e.g. "plan approved").
- **`notification`** — Send a notification through a configured channel.

## Common patterns

- **Sequential pipeline**: chain tasks with `flow.then`; the last omits it.
- **Branch + merge**: `switch_case` to route, then converge `then` targets onto a
  shared downstream task.
- **Parallel fan-out**: `fork` with multiple branches, then a `transform` to merge
  branch outputs (`compete: false`).
- **Approval loop**: `human_input` with an `approve` outcome that proceeds and a
  `reject` outcome that routes back to an earlier task or to `end`.
- **Structured handoff between agents**: give the producing `agent_call`/`llm_call`
  an output schema, `export.as: "${ .structured }"`, and read fields downstream via
  `${ $context.<task>.<field> }`.
