# Validation Checklist

Run through this checklist before presenting or applying any workflow. The
authoritative check is the `validate_workflow_yaml` MCP tool, which runs the same
validation pipeline as workflow create/update and returns a state of
`VALID`, `INVALID`, or `FAILED` plus errors and warnings. This checklist catches
the most common issues so the first validation pass is clean.

## Required fields

| Check | Rule |
|---|---|
| `apiVersion` | Exactly `agentic.stigmer.ai/v1` |
| `kind` | Exactly `Workflow` |
| `metadata.name` | Present and non-empty |
| `spec.document` | Present with `dsl`, `namespace`, `name`, `version` |
| `spec.tasks` | Present with at least one task |

## Task graph integrity

1. **Unique names** — every `task.name` is unique within the workflow.
2. **Valid `flow.then` targets** — every `then` (in `flow`, in `switch_case` cases,
   and in `human_input` outcomes) references an existing task name, or the literal
   `end`.
3. **Terminal tasks** — the final task on each path omits `flow.then` (or routes to
   `end`). Do not point `then` at a non-existent task.
4. **Reachability** — every task is reachable from the entry path; no orphaned tasks.
5. **No cycles unless intended** — revision loops (e.g. reject → earlier task) are
   fine, but make sure they can terminate.

## Task kinds

1. **Known kind** — `kind` is one of the 19 exact YAML names:
   `set_vars, http_call, grpc_call, activity_call, switch_case, for_each, fork,
   try_catch, listen, wait, raise_error, run_workflow, agent_call, llm_call,
   transform, human_input, validate, emit_event, notification`.
   An unknown kind fails parsing immediately.
2. **Config matches kind** — `task_config` fields match the schema returned by
   `get_task_kind(kind="<kind>")`. Fetch it if unsure.

## References to other resources

1. **Agents exist** — every `agent_call` `agent:` slug was verified with `get_agent`.
2. **MCP servers / skills exist** — anything referenced is verified with
   `get_mcp_server` / `get_skill`.
3. **No guessed slugs or tool names** — all are confirmed against the platform.

## Expressions and data flow

1. **Quoted expressions** — strings starting with `${` are quoted so YAML parses
   them correctly.
2. **Valid context references** — `${ $context.<task>... }` points at a task that
   runs **before** the referencing task and that uses `export`.
3. **`env` references declared** — every `${ $context.env.NAME }` has a matching
   entry in `spec.env`.
4. **Structured output exported** — tasks read via `${ $context.<task>.<field> }`
   export their structured result (`export.as: "${ .structured }"` for agent/LLM
   tasks with an output schema).

## Cost & safety

1. **Budget present** — any workflow with `llm_call` or `agent_call` tasks declares
   a `spec.budget` (at least `max_cost_micros` and `max_duration_seconds`).
2. **Retries on structured output** — tasks with a response/output schema set
   `on_invalid` and `max_retries` so transient invalid output self-heals.
3. **Approval gates where needed** — irreversible or high-impact actions are gated
   behind a `human_input` task.

## YAML hygiene

1. Spaces only, no tabs.
2. No trailing whitespace.
3. **No `status` fields** anywhere — `status` is system-managed.
4. Multi-line prompts use `|` or `>` block scalars.

## Final step

Call `validate_workflow_yaml(yaml="<full-yaml>")`. If the state is not `VALID`,
fix the reported errors and re-run until it is. Only then apply with
`stigmer apply -f <file>.yaml`.
