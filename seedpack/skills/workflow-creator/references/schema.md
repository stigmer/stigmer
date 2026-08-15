# Workflow YAML Schema Reference

Canonical field reference derived from the `ai/stigmer/agentic/workflow/v1` proto
definitions. The live `get_task_kind_registry` / `get_task_kind` MCP tools are the
authoritative source for per-task-kind config — this document covers the
workflow-level envelope and the conventions shared by all tasks.

## Document Structure

```yaml
apiVersion: agentic.stigmer.ai/v1   # REQUIRED — exact string
kind: Workflow                       # REQUIRED — exact string
metadata:                            # REQUIRED
  name: <string>                     # REQUIRED — human-readable name
  slug: <string>                     # optional — auto-generated from name if omitted
  org: <string>                      # recommended — org slug
  visibility: <enum>                 # optional — visibility_private (default) | visibility_public
  labels: {key: value}               # optional — filtering metadata
  annotations: {key: value}          # optional — non-filtering metadata
spec:                                # REQUIRED
  document:                          # REQUIRED — workflow identity block
    dsl: "1.0.0"
    namespace: <org-slug>
    name: <workflow-name>
    version: "1.0.0"
  env: {}                            # optional — run-time input declarations
  budget: {}                         # recommended — cost/time/token caps
  tasks: []                          # REQUIRED — the task graph (>= 1 task)
```

## metadata

| Field | Required | Format | Notes |
|---|---|---|---|
| `name` | yes | any string | Human-readable display name |
| `slug` | no | `^[a-z][a-z0-9-]*$`, 1-63 chars | Auto-generated from name if omitted |
| `org` | recommended | `^[a-z][a-z0-9-]*$` | Defaults to CLI context org if omitted |
| `visibility` | no | `visibility_private` or `visibility_public` | Private by default |
| `labels` | no | map<string,string> | For filtering/search |
| `annotations` | no | map<string,string> | Non-filtering metadata |

## spec.document

The identity block for the workflow definition. All four fields are conventional:

```yaml
document:
  dsl: "1.0.0"          # DSL version — use "1.0.0"
  namespace: <org-slug> # usually matches metadata.org
  name: <workflow-name> # usually matches metadata.name
  version: "1.0.0"      # semantic version of THIS workflow definition
```

## spec.env

Declares the inputs a user supplies when starting the workflow. Schema only —
values are provided at run time. Reference them in tasks via `${ $env.NAME }`.

```yaml
env:
  POSTGRES_CONNECTION_URL:
    description: "PostgreSQL connection URL for the analytics database"
    is_secret: true
  REPORT_DATE:
    description: "Date to analyze (ISO 8601). Defaults to today if omitted."
    optional: true
```

| Field | Required | Notes |
|---|---|---|
| `description` | recommended | Shown to the user when launching the workflow |
| `is_secret` | no | `true` for tokens/passwords/connection URLs; masks the value |
| `optional` | no | Default `false` (required). `true` allows omission |

## spec.budget

Caps resource consumption. Strongly recommended for any workflow containing
`llm_call` or `agent_call` tasks — it is the primary guardrail against runaway cost.

```yaml
budget:
  max_cost_micros: 3000000      # 3000000 micros = $3.00
  max_total_tokens: 300000      # optional token ceiling
  max_duration_seconds: 600     # wall-clock ceiling
```

When a budget is exceeded, the workflow stops.

## spec.tasks[]

The ordered list of tasks forming the DAG. Every task shares this envelope:

```yaml
tasks:
  - name: <task-name>          # REQUIRED — unique within the workflow
    kind: <task-kind>          # REQUIRED — one of the 19 kinds (see task-kinds.md)
    task_config:               # REQUIRED — kind-specific (see get_task_kind)
      <fields>
    export:                    # optional — publish output for downstream tasks
      as: "${ . }"
    flow:                      # optional — control flow to the next task
      then: <next-task-name>
```

### name

- Unique within the workflow.
- Referenced by `flow.then`, `switch_case` cases, and `${ $context.<name>... }`.
- Use lowercase snake_case by convention (e.g. `analyze_player_data`).

### kind

One of the 19 task kinds. Use the exact YAML name (see
[task-kinds.md](task-kinds.md)). Unknown kinds fail validation immediately.

### task_config

Kind-specific. Fetch the exact schema with `get_task_kind(kind="<kind>")` before
writing it. Examples of common shapes appear in [examples.md](examples.md).

### export

Publishes the task's result so later tasks can read it.

- `export.as: "${ . }"` — export the entire task result.
- `export.as: "${ .structured }"` — export only the structured output (common for
  `agent_call` / `llm_call` tasks that produce schema-validated JSON).

### flow

Controls what runs next.

```yaml
flow:
  then: <next-task-name>   # name of the next task, or "end" to terminate this path
```

- Omit `flow` entirely on a terminal task (implicit end).
- For branching, `switch_case` / `human_input` outcomes carry their own `then`
  targets inside `task_config` instead of (or in addition to) `flow.then`.

## Referencing Data — Expression Syntax

Stigmer uses `${ ... }` expressions to read values across the workflow:

| Reference | Meaning |
|---|---|
| `${ $env.NAME }` | A run-time input declared in `spec.env` |
| `${ $context.<task-name> }` | The full exported output of a prior task |
| `${ $context.<task-name>.<field> }` | A field within a prior task's output |
| `${ . }` | The current task's input/result (used in `export.as` and `transform.input`) |
| `${ .structured }` | The structured-output portion of an agent/LLM result |

Inside a `transform` task, the `expression` operates on the object passed via
`input`, using JQ when `engine: TRANSFORM_ENGINE_JQ`.

## YAML Syntax Rules

1. Use `|` or `>` block scalars for long prompts/instructions.
2. Spaces only — no tabs.
3. No trailing whitespace in values.
4. Never set `status` — system-managed.
5. Quote expression strings that begin with `${` so YAML does not misparse them.
