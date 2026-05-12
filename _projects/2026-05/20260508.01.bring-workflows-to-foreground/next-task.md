# Next Task: 20260508.01.bring-workflows-to-foreground

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Bring Workflows to the Foreground

**Description**: Complete the missing AI orchestration layer on top of the existing Temporal + CNCF Serverless Workflow foundation, then surface workflows as a first-class product in Stigmer's UI, CLI, and APIs.

**Goal**: Make workflows a first-class, visible, user-facing product surface — from invisible backend plumbing to durable, observable, deployable agent applications with structured AI outputs, typed task schemas, execution traces, human approval gates, budget controls, and a hybrid editor experience.

**Research Report**: `_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

**Tech Stack**: Protobuf, Go (workflow-runner/Temporal), Java (stigmer-service), TypeScript/React (Web UI), Python (agent-runner/LangGraph), Temporal, CNCF Serverless Workflow

**Components**: Proto APIs (workflow/workflowexecution/workflowinstance/tasks), workflow-runner, stigmer-service, Web UI, CLI, agent-runner, model registry, artifact store

## Current Status

**Created**: 2026-05-08
**Last Session**: 2026-05-12 — T05 COMPLETE (all batches)
**Current Task**: T05 COMPLETE — ready for T06 (Event Stream)
**Phase**: Phase 0 — Harden the Workflow Core
**Next Task**: T06 (Event Stream)

## Session Progress (2026-05-12, T05)

### T05: Workflow-Level Budget Primitives — COMPLETE

Added workflow-level and per-task budget declarations to the proto domain, validation warnings, and registry updates.

#### Proto Changes
- **WorkflowBudget message**: `max_cost_micros` (int64 micro-USD), `max_total_tokens`, `max_duration_seconds`, `on_exceeded` (BudgetExceededPolicy)
- **BudgetExceededPolicy enum**: `terminate`, `human_review`, `warn`
- **Per-task budget on LlmCallTaskConfig**: `max_cost_micros`, `max_total_tokens` (fields 11, 12)
- **Per-task budget on AgentExecutionConfig**: `max_cost_micros` (field 5)

#### Validation + Registry
- **CheckBudgetWarnings()**: Warns on missing budget with cost-incurring tasks, per-task caps exceeding workflow budget, combined costs exceeding budget
- **Sidecar YAML updates**: Budget field groups added to `llm_call.yaml` and `agent_call.yaml`
- **Registry regenerated**: `task-kind-registry.json` updated with new fields

#### Codegen Bug Fix (T04 loose end)
- Fixed duplicate `"role": "query"` causing broken TS/Python/Go SDK generation
- Added `ProtoFile` field to `ServiceDefinition` for correct import resolution
- All SDK generators now handle multiple services with the same role

#### Key Design Decisions
- **D1**: No `budget_guard` task kind — use `validate` with budget context variables
- **D2**: Proto + validation + registry only — runtime enforcement deferred to T13
- **D3**: Amounts in micro-USD (int64) — matches billing domain convention
- **D4**: Per-task budget on cost-incurring tasks only (agent_call, llm_call)

## Previous Sessions

### T04 (COMPLETE — 2026-05-12)
Task Schema Registry — 19 task kind descriptors, registry generator, HTTP endpoints, cross-task reference validation, SDK hook

### T03 (COMPLETE — 2026-05-12)
| Batch | Task Types | Enum Values | Commit |
|-------|-----------|-------------|--------|
| 1 | llm_call + transform | 14, 15 | `417ee6042` |
| 2 | human_input + validate | 16, 17 | `0163c9866` |
| 3 | emit_event + notification | 18, 19 | `9b877d51b` |

### T02 (COMPLETE)
- Structured Agent Output Model

## Next Steps
1. T06: Event Stream — define workflow event contracts for runtime observability
2. After T06: T07 (Artifact Store) to complete Phase 0
3. After Phase 0: Phase 1 — Foreground MVP (UI pages, execution viewer, YAML editor)

## Context for Resume
- T05 is fully complete — all proto, validation, registry, and codegen changes implemented
- All codegen pipelines run cleanly (both `make codegen` in stigmer and `make protos` in stigmer-cloud)
- `task-kind-registry.json` placed in stigmer-cloud classpath
- `CheckBudgetWarnings()` is a standalone function — NOT wired into `ValidateWorkflow()` yet (intentional: it returns warnings, not errors, and the wiring depends on how the caller wants to surface them)
- `buf lint`, `buf breaking`, `go vet`, `go test`, `tsc --noEmit` all pass
- Generated TypeScript SDK includes `WorkflowBudgetInput` type with `buildWorkflowBudgetProto` builder

## Essential Files to Review

### 1. T05 Plan
```
/Users/suresh/.cursor/plans/t05_budget_primitives_2cc79920.plan.md
```

### 2. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t05-budget-primitives.md
```

### 3. Task Directory
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 4. T05 Key Files Modified
- **Proto**: `apis/ai/stigmer/agentic/workflow/v1/spec.proto` (WorkflowBudget)
- **Proto**: `apis/ai/stigmer/agentic/workflow/v1/enum.proto` (BudgetExceededPolicy)
- **Proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/llm_call.proto` (per-task budget)
- **Proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto` (per-task budget)
- **Validation**: `backend/services/workflow-runner/pkg/validation/validate.go` (CheckBudgetWarnings)
- **Sidecars**: `apis/.../tasks/meta/llm_call.yaml`, `agent_call.yaml` (budget groups)
- **Codegen fix**: `tools/codegen/proto2schema/main.go`, `generator/sdk_client*.go`

### 5. Existing Workflow Protos (the domain being enhanced)
- **Workflow spec**: `apis/ai/stigmer/agentic/workflow/v1/spec.proto`
- **Workflow enum**: `apis/ai/stigmer/agentic/workflow/v1/enum.proto`
- **Workflow tasks**: `apis/ai/stigmer/agentic/workflow/v1/tasks/`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Review the task plan (T06 needs to be created)
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Execute the next task

## Project Phases

- **Phase 0**: Harden Workflow Core (T02-T07) — structured outputs, new task types, schema registry, budgets, event stream, artifact store
- **Phase 1**: Foreground MVP (T08-T14) — UI pages, execution viewer, YAML editor, run from UI, CLI, dashboard
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Plan T06" - Design Event Stream
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
