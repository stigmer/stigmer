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
**Last Session**: 2026-05-12 — T06 COMPLETE
**Current Task**: T06 COMPLETE — ready for T07 (Artifact Store)
**Phase**: Phase 0 — Harden the Workflow Core
**Next Task**: T07 (Artifact Store)

## Session Progress (2026-05-12, T06)

### T06: Execution Event Stream Model — COMPLETE

Defined the full proto contract for workflow execution events: append-only event log with typed payloads, paginated query RPC, server-streaming subscription, and atomic event production via existing `updateStatus`.

#### New Proto: `event.proto`
- **`WorkflowExecutionEvent`**: envelope with `event_id`, `event_type`, `sequence_number`, `occurred_at`, `task_name`, `oneof payload`
- **`WorkflowEventType`**: 17 event types across 6 categories (execution, task, agent, approval, budget, signals)
- **20 typed payload messages**: domain-specific fields per event type (costs in micro-USD, durations in ms, child execution refs)

#### Query RPCs
- **`getEventLog`**: paginated event fetch with cursor-based pagination, type filtering, task name filtering
- **`subscribeEvents`**: server-streaming with replay + live tail semantics

#### Production Contract
- **`events` field on `WorkflowExecutionUpdateStatusInput`**: atomic event production piggybacked on existing RPC
- **Removed dead code**: `WorkflowExecutionUpdate` message and `WorkflowUpdateType` enum deleted (never wired)

#### Codegen Fix
- Fixed TS SDK codegen: streaming output types from non-api proto files now correctly resolve their `_pb` import suffix

#### Key Design Decisions
- **CQRS-like separation**: Events complement snapshots, not replace them
- **Option A (piggyback)**: Events sent with `updateStatus`, no new infrastructure
- **CloudEvents semantics as native proto**: Internal events use proto-native fields; full CloudEvents reserved for `emit_event`
- **No deprecation, just delete**: Pre-beta project, no backward compatibility needed

## Previous Sessions

### T05 (COMPLETE — 2026-05-12)
Workflow Budget Primitives — WorkflowBudget, BudgetExceededPolicy, per-task budgets, CheckBudgetWarnings(), codegen multi-role fix

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
1. T07: Artifact Store — design artifact storage contract for workflow data and outputs (final Phase 0 task)
2. After T07: Phase 1 — Foreground MVP (UI pages, execution viewer, YAML editor)
3. T09 (Execution Viewer) will consume the event stream defined in T06

## Context for Resume
- T06 is fully complete — event proto, query RPCs, production contract, and all codegen done
- T06 fixed a TS codegen bug: streaming output types from non-api proto files now correctly resolve imports
- All codegen pipelines run cleanly (both `make codegen` in stigmer and `make protos` in stigmer-cloud)
- `buf lint`, `buf breaking`, Go/TS/React/Java/Python stubs all compile cleanly
- `WorkflowExecutionUpdate` and `WorkflowUpdateType` removed (dead code, per user directive: no deprecation in pre-beta)
- `CheckBudgetWarnings()` (from T05) is still standalone — NOT wired into `ValidateWorkflow()` yet

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t06-execution-event-stream.md
```

### 2. Task Directory
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 3. T06 Key Files Modified
- **Proto (new)**: `apis/ai/stigmer/agentic/workflowexecution/v1/event.proto` (event model)
- **Proto (modified)**: `apis/ai/stigmer/agentic/workflowexecution/v1/query.proto` (+2 RPCs)
- **Proto (modified)**: `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto` (+3 messages, +1 field, removed dead code)
- **Codegen fix**: `tools/codegen/generator/sdk_client_ts.go` (streaming output type import resolution)
- **Schema**: `tools/codegen/schemas/services/workflowexecution.json` (regenerated)

### 4. Existing Workflow Protos (the domain being enhanced)
- **Workflow spec**: `apis/ai/stigmer/agentic/workflow/v1/spec.proto`
- **Workflow enum**: `apis/ai/stigmer/agentic/workflow/v1/enum.proto`
- **Workflow execution**: `apis/ai/stigmer/agentic/workflowexecution/v1/`
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
- "Plan T07" - Design Artifact Store
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
