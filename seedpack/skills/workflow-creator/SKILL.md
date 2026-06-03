---
name: workflow-creator
description: >
  Create, refine, and diagnose Stigmer Workflow YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill whenever the user wants to build a
  workflow, automate a multi-step pipeline, orchestrate agents into a sequence,
  add approval gates or branching to an automation, turn a described process into
  a runnable workflow, or fix a failing workflow. Triggers on requests like:
  "create a workflow", "build a pipeline that does X", "wire these agents
  together", "automate this daily process", "add a human approval step",
  "design a workflow that runs the analyst then the strategist", or
  "my workflow failed, help me fix it" — even when the word "workflow" is not
  used explicitly.
---

# Workflow Creator

Create production-quality Stigmer Workflow YAML that passes `validate_workflow_yaml`
on the first attempt, then apply it to the platform.

A Stigmer workflow is a declarative DAG of **tasks**. Each task has a `kind`
(one of 19 task kinds), a `task_config`, and a `flow` block describing what runs
next. Workflows orchestrate agents, LLM calls, branching, parallelism, human
approval gates, and external calls into a single reliable automation pipeline.

## Operating Modes

You operate in one of three modes based on the request:

- **Generate** — the user describes what to automate. Discover resources, design
  the task graph, generate YAML, validate, and iterate until it passes.
- **Refine** — the user has an existing workflow and wants changes. Understand
  the current structure, apply the modifications, validate, explain what changed.
- **Diagnose** — the user references a failed execution. Inspect the execution
  status and event log, find the failing task, and propose a validated fix.

## Workflow

Follow these steps in order for every workflow request.

### Step 1: Understand Intent

Clarify before building if anything is ambiguous:

- What is the goal? What triggers the workflow (manual run, schedule, event)?
- Which agents, MCP servers, or skills are involved?
- Are there approval gates or human review steps?
- What should happen on failure (retry, skip, escalate)?
- What inputs does the workflow need from the user at run time (these become `env`)?
- Which organization owns the workflow?

If the user already gave enough detail, proceed directly. Do not invent
requirements — **ask, don't assume**.

### Step 2: Discover Platform Resources

**Before referencing any agent, MCP server, or skill, verify it exists.** Use the
Stigmer MCP server tools connected at runtime:

- `search` — find resources by keyword and kind (e.g. agents in an org)
- `get_agent` — confirm an agent exists and inspect its spec
- `get_mcp_server` — confirm an MCP server exists and inspect its tools
- `get_skill` — confirm a skill exists
- `get_workflow` — inspect an existing workflow (Refine mode)

Never guess or hallucinate agent slugs, MCP server slugs, or tool names. If a
needed resource does not exist, tell the user and ask how to proceed — do not
insert placeholder references.

### Step 3: Load Task Kind Knowledge

The 19 task kinds and their exact config schemas are served live by the platform.
Always treat the live registry as authoritative:

- `get_task_kind_registry` — load all 19 task kind descriptors (field schemas,
  JSON Schemas, categories, examples, output shapes)
- `get_task_kind` — load full detail for a single kind before writing its config

Read [references/task-kinds.md](references/task-kinds.md) for a quick orientation
to what each kind is for, then fetch the live descriptor for the exact fields.

### Step 4: Compose the Workflow YAML

Read [references/schema.md](references/schema.md) for the complete field reference
and [references/examples.md](references/examples.md) for complete, validated
examples (linear, branching, parallel, agent-orchestration, approval loops).

Top-level structure:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: <workflow-name>
  org: <org-slug>
spec:
  document:
    dsl: "1.0.0"
    namespace: <org-slug>
    name: <workflow-name>
    version: "1.0.0"
  env:
    INPUT_NAME:
      description: "What the user must provide at run time"
      is_secret: false
  budget:
    max_cost_micros: 3000000
    max_duration_seconds: 600
  tasks:
    - name: <task-name>
      kind: <task-kind>
      task_config:
        <kind-specific-config>
      export:
        as: "${ . }"
      flow:
        then: <next-task-name>
```

Composition rules:

- Every task needs a unique `name`, a `kind`, and a `task_config`.
- `flow.then` must reference a real task name. The last task in a path omits
  `flow.then` (implicit end). Use `then: end` to terminate a branch early.
- Use `export.as` to publish a task's output; reference it downstream with
  `${ $context.<task-name>.<field> }`. Run-time inputs are `${ $context.env.NAME }`.
- For `agent_call` and `llm_call` tasks, prefer a `budget` so runaway cost is
  capped. Use `on_invalid` / `max_retries` when you require structured output.
- Use `switch_case` for branching, `fork` for parallel branches, `human_input`
  for approval gates, and `try_catch` for tasks that can fail recoverably.
- Never set `status` — it is system-managed.

### Step 5: Validate Before Presenting

Always validate before showing or applying YAML:

`validate_workflow_yaml(yaml="<full-yaml-content>")`

If the result state is not `VALID`:

1. Read the errors and warnings carefully.
2. Fix the YAML.
3. Validate again. Repeat until the state is `VALID`.

Never present or apply YAML that has not passed validation. Run through
[references/validation.md](references/validation.md) as a final checklist.

### Step 6: Apply to the Platform

Workflows are created and updated through the **Stigmer CLI**, not the MCP server.
(The MCP `apply_workflow` tool is temporarily unavailable, so always use the CLI
for the apply step.)

```bash
stigmer apply -f <workflow-file>.yaml
```

If the workflow references agents, MCP servers, or skills that are not yet on the
platform, apply those first (`stigmer apply -f agent.yaml`,
`stigmer skill push <skill-dir>`), then apply the workflow.

### Step 7: Present and Explain

Present the final YAML in a fenced code block. After it, briefly explain:

- What the workflow does (high-level summary).
- A task-by-task walkthrough of the pipeline and branching.
- Any `env` inputs the user must provide when running it.
- How to run it: `stigmer run workflow <workflow-slug>` (or via the web UI).

## Diagnose Mode

When the user references a failed execution:

1. `get_workflow_execution(execution_id="<id>")` — status and errors.
2. `get_workflow_execution_events(execution_id="<id>")` — the event log
   (optionally filter by `task_name`).
3. Analyze: which task failed, and why?
   - **Definition error** (bad config): fix the YAML, re-validate, re-apply.
   - **Runtime error** (service down, bad input): explain the root cause and the
     remediation; the YAML may not need to change.

## Key Principles

1. **Discover first, write second** — verify every referenced resource exists.
2. **Ask, don't assume** — clarify ambiguous intent and missing resources.
3. **Validate exhaustively** — every YAML must reach state `VALID` before applying.
4. **No placeholders** — never output `<TODO>` or `<your-slug-here>`; every value
   is concrete.
5. **No status fields** — `status` is system-managed.
6. **Relative references by default** — same-org agents/MCP servers/skills are
   referenced by slug; the org is resolved from `metadata.org`.
7. **Budget-aware** — add a `budget` to any workflow with LLM or agent tasks.

## Reference Files

| File | When to read |
|------|--------------|
| [references/schema.md](references/schema.md) | Field-level details for any part of the workflow spec |
| [references/task-kinds.md](references/task-kinds.md) | Orientation to the 19 task kinds and when to use each |
| [references/examples.md](references/examples.md) | Complete validated examples (linear → branching → parallel → agent orchestration → approval loops) |
| [references/validation.md](references/validation.md) | Final validation checklist before presenting/applying |
