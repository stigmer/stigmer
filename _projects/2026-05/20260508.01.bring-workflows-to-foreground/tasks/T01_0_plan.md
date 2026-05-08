# Task T01: Workflow Domain Foreground — Master Plan

**Created**: 2026-05-08
**Status**: PENDING REVIEW
**Type**: Feature Development (Multi-Phase)
**Research**: `_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

## Objective

Complete the missing AI orchestration layer on top of the existing Temporal + Serverless Workflow foundation, then surface workflows as a first-class product in Stigmer's UI, CLI, and APIs.

## Context

Deep research validated that the architectural foundation (Temporal + CNCF Serverless Workflow DSL + Template-Instance-Execution pattern) is sound and should NOT be replaced. However, it identified critical gaps in:

1. **Agent output handling** — routing on unstructured text is the #1 modeling flaw
2. **Task model completeness** — missing AI-first task types (llm_call, extract, validate, human_input, transform)
3. **Schema typing** — `kind + Struct` needs a typed validation/editing layer on top
4. **Execution observability** — agent_call is a black box, no execution viewer exists
5. **Workflow-level HITL** — approval gates only exist inside agents, not in the workflow itself
6. **UI/UX** — zero workflow surface in the product today

## Phased Task Breakdown

### Phase 0: Harden the Workflow Core (before any UI)

> "Fix the foundation before building the house."

**T02: Structured Agent Output Model**
- Add dual-channel output to `agent_call`: `final_text` + `structured` (typed JSON validated against optional schema)
- Add `output_schema` field to `AgentCallTaskConfig` proto
- Add `artifacts`, `tool_trace`, `usage`, `quality` fields to agent call output
- Add `on_invalid` policy (retry, repair, human_review)
- Update `switch_case` to warn when routing on raw text without structured output
- **Why first**: Everything downstream (routing, validation, transform, UI) depends on structured outputs being available

**T03: P0 New Task Types — Proto Definitions**
- Add `llm_call` task kind + `LlmCallTaskConfig` proto (model, prompt, schema, budget, retry)
- Add `extract` / `structure` task kind + `ExtractTaskConfig` proto (source, schema, method, repair)
- Add `validate` / `assert` task kind + `ValidateTaskConfig` proto (schema, rules, on_fail)
- Add `human_input` / `approval_gate` task kind + `HumanInputTaskConfig` proto (approvers, form, timeout, outcomes)
- Add `transform` task kind + `TransformTaskConfig` proto (engine: jq/jsonata/template, expression, output)
- Add `notification` task kind + `NotificationTaskConfig` proto (channel, template, recipients)
- Add `emit_event` task kind (closes the listen/emit symmetry gap)
- Update `WorkflowTaskKind` enum with new entries
- **Why**: These are the building blocks that make workflows AI-native rather than just cloud-native

**T04: Task Schema Registry**
- Define a `TaskKindDescriptor` proto (kind, config proto type, JSON Schema, UI schema, output schema, validation rules, docs, examples)
- Create registry data for all existing 13 + new P0 task kinds
- Build server-side validator that uses registry for task config validation
- **Why**: The future UI builder, CLI validation, SDK docs, and expression editor all need this metadata

**T05: Workflow-Level Budget Primitives**
- Add `budget` field to `WorkflowSpec` (max_cost_usd, max_tokens, max_agent_steps, max_parallelism)
- Add per-task budget overrides
- Add `budget_guard` task kind for explicit budget checkpoints
- Add `on_exceeded` policy (human_input, terminate, cheaper_model)
- **Why**: Without budget controls, fork/retry/agent loops can cause cost explosions

**T06: Execution Event Stream Model**
- Define proto for workflow execution events (task.started, task.completed, task.failed, agent.stream.delta, agent.tool.started, approval.requested, budget.updated, artifact.created)
- Use CloudEvents as envelope (CNCF graduated project, aligns with Serverless Workflow)
- Design the derived execution projection (optimized for UI queries, not raw Temporal history)
- **Why**: The execution viewer UI needs a clean event stream, not raw Temporal event history

**T07: Artifact Store Integration**
- Define artifact storage model (artifact refs in context instead of inline large payloads)
- Add `artifact_store` task kind for explicit persistence
- Add automatic artifact promotion for large agent outputs
- Define retention policies
- **Why**: Temporal histories are capped at 51,200 events / 50 MB; large agent outputs must live outside

### Phase 1: Foreground MVP (user-visible product)

> "Ship visibility before authoring."

**T08: Workflow List & Detail Pages (UI)**
- Workflow templates list with search/filter
- Workflow detail page (spec, tasks graph preview, instances, recent executions)
- WorkflowInstance list and detail
- WorkflowExecution list with status, duration, cost, trigger info
- Status indicators (running, completed, failed, paused, waiting approval)

**T09: Execution Viewer — The Hero Feature (UI)**
- Three-pane layout: graph view (left), timeline (center), details/logs (right)
- Node statuses: pending, running, streaming, paused, waiting-approval, succeeded, failed, skipped, retried
- Agent call subtrace expansion (system prompt, model, messages, tool calls, MCP calls, tokens, cost, artifacts, streaming)
- Task IO inspection (input JSON, output JSON, export path, validation result)
- Approval panel (requested, approvers, form, timeout, decisions, audit trail)
- Cost summary per task and per run
- Cancel/retry/resume controls

**T10: YAML Editor with Graph Preview (UI)**
- Schema-aware YAML editor with syntax highlighting
- Immediate validation (compile errors, expression validation, reference checking)
- Live topology graph preview (read-only DAG generated from YAML)
- Side-by-side YAML + graph layout

**T11: Run Workflow from UI**
- Input form auto-generated from workflow input schema
- Instance/environment selection
- Start/cancel/watch controls
- Link to execution viewer on run

**T12: CLI Parity**
- `stigmer workflow list`
- `stigmer workflow get <workflow>`
- `stigmer workflow validate workflow.yaml`
- `stigmer workflow apply workflow.yaml`
- `stigmer workflow diff workflow.yaml`
- `stigmer workflow instance create <workflow> --env prod`
- `stigmer run workflow <instance> --input input.json --watch`
- `stigmer workflow logs <execution-id>`
- `stigmer workflow trace <execution-id>`
- `stigmer workflow cancel <execution-id>`
- `stigmer workflow resume <execution-id> --signal approval.json`

**T13: P0 Task Types — Backend Implementation**
- Implement runtime execution for each P0 task kind in the workflow-runner (Go/Temporal)
- Wire `llm_call` to model registry + LLM providers
- Wire `human_input` to Temporal signals/updates + external approval records
- Wire `transform` to JQ/JSONata engine
- Wire `validate` to JSON Schema validation
- Wire `notification` to notification providers (Slack, email, Discord)
- Wire `emit_event` to CloudEvents emission

**T14: Dashboard Integration**
- Add Workflows section to main dashboard
- Pending Approvals widget
- Failed Runs widget
- Cost by Workflow chart
- Agent Usage Across Workflows
- SLA/latency summaries

### Phase 2: Visual Builder (after Phase 1 is stable)

**T15: Visual Canvas Editor**
- Task palette, agent palette, connectors
- Drag-and-drop DAG construction
- Inspector panel (selected node config, input mapping, output schema, retry/timeout/budget)
- YAML round-trip (canvas changes sync to YAML and vice versa)
- Auto-layout, subworkflow groups
- Branch condition builder
- Approval form builder

### Phase 3: AI-Assisted Creation

**T16: Natural Language to Workflow**
- "Describe what you want" prompt-to-workflow generation
- Chat-to-workflow conversion ("Turn this agent session into a workflow")
- Workflow repair assistant ("Explain this failure", "Suggest retry/fallback")
- Template suggestion engine

### Phase 4: Advanced Agentic Orchestration

**T17: Advanced Task Types**
- `plan_and_execute` (agent proposes bounded sub-plan, validate, execute)
- `agent_handoff` (structured context transfer between agents)
- `eval` / `llm_judge` (reusable rubric-based evaluation)
- `batch` (batch processing with concurrency control)
- `cache` (avoid repeated expensive calls)
- `code_execution` (sandboxed Python/JS)
- `memory_recall` / `memory_write` (vector search, cross-run memory)
- `compensate` (saga-style undo for side effects)

## Key Design Principles (from research)

1. **Deterministic outer, autonomous inner**: The workflow owns durability, state, approvals, budgets, retries, policy, RBAC. Agents own local reasoning, tool selection, summarization within bounded envelopes.
2. **Structured outputs for routing**: Never route on prose. `switch_case` operates on structured state only. Semantic routing needs an explicit `llm_call` or `classify` step.
3. **Artifact references, not inline blobs**: Large outputs go to artifact store. Context carries references.
4. **Execution viewer before visual builder**: Ship observability before authoring.
5. **Typed validation on top of flexible envelope**: Keep `kind + Struct` for YAML/API, layer typed validation and schema registry on top.
6. **Workflows as agent applications**: Not a separate product; the automation layer above agents.

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Routing on unstructured text | T02 adds structured output model before any UI work |
| Struct opacity | T04 adds task schema registry for typed validation |
| Temporal history bloat | T07 adds artifact store, T06 adds derived projection |
| Agent call black box | T09 execution viewer expands agent calls into subtraces |
| HITL only in agents | T03 adds `human_input` task kind at workflow level |
| Cost explosions | T05 adds budget primitives, T03 adds `budget_guard` |
| Building wrong UI first | Phase ordering ensures execution viewer ships before canvas |

## Suggested Starting Point

Begin with **T02 (Structured Agent Output Model)** because it is the highest-priority architectural fix and everything else depends on it.

## Next Task Preview

**T02: Structured Agent Output Model** — Add dual-channel output contract to agent_call task, update proto definitions, define output schema, validation, and repair policies.

---

**Please review this plan and provide your feedback. I will not proceed to execution until you explicitly approve.**
