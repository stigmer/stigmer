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
**Last Session**: 2026-05-12 — T08 COMPLETE (Phase 1 started)
**Current Task**: T08 COMPLETE — Workflow List and Detail Pages
**Phase**: Phase 1 — Foreground MVP — IN PROGRESS
**Next Task**: T09 (Execution Viewer) or T13 (Backend Implementation)

## Session Progress (2026-05-12, T08)

### T08: Workflow List and Detail Pages — COMPLETE

Built the full Workflow UI layer following SDK-first architecture (DD-001): codegen fix, React SDK data hooks, styled components, web console pages, sidebar navigation, and barrel exports.

#### Layer 1: Codegen Fix — WorkflowClient.list()
- Discovered `WorkflowClient` had no `list()` method — `searchListResources` map in `proto2schema` didn't include workflow
- Added `"workflow": true` to `tools/codegen/proto2schema/main.go` and re-ran `make codegen`
- `WorkflowClient.list()` now generated across Go, TS, Python, Java SDKs

#### Layer 2: React SDK Data Hooks (5 new files in `sdk/react/src/workflow/`)
- `useWorkflow` (single by org/slug), `useWorkflowList` (paginated with scope/search), `useWorkflowCount`, `useWorkflowInstances`, `useWorkflowExecutionList`

#### Layer 3: React SDK Styled Components (3 new files)
- `WorkflowExecutionPhaseBadge` — execution phase status badges
- `WorkflowTaskList` — compact task display with kind icons
- `WorkflowDetailView` — composed detail view with 4 tabs (Overview, Tasks, Instances, Executions)

#### Layer 4: Web Console Pages (9 new files)
- Routes: `/workflows`, `/workflows/[org]/[slug]`, `/workflows/executions`
- Domain: `WorkflowListPage`, `WorkflowDetailPage`, `WorkflowExecutionListPage`, `WorkflowLayout`, `workflow-navigation.tsx`, `WorkflowBreadcrumb`

#### Layer 5: Sidebar + Navigation
- Top-level "Workflows" sidebar entry between Library and Runners
- Scope persistence for workflow list

#### Layer 6: Exports + Type Safety
- All new hooks/components exported from `@stigmer/react`
- `useDeleteResource` extended with `"workflow"` kind
- Fixed `ValidationState` enum and `optional` field access bugs

#### Decisions
- Workflows are top-level sidebar item (not nested under Library)
- WorkflowInstance embedded as tab on Workflow detail page (not standalone route)
- Export actions (YAML/JSON) deferred — no `serializeWorkflowYaml` exists yet

## Previous Sessions

### T07 (COMPLETE — 2026-05-12)
Artifact Store Proto Contract — content-addressable blob storage, ArtifactQueryController/CommandController, ArtifactStorageState, retention policies

### T06 (COMPLETE — 2026-05-12)
Execution Event Stream Model — append-only event log with 17 typed event types, paginated query, server-streaming subscription

### T05 (COMPLETE — 2026-05-12)
Workflow Budget Primitives — WorkflowBudget, BudgetExceededPolicy, per-task budgets, CheckBudgetWarnings()

### T04 (COMPLETE — 2026-05-12)
Task Schema Registry — 19 task kind descriptors, registry generator, HTTP endpoints, cross-task reference validation, SDK hook

### T03 (COMPLETE — 2026-05-12)
New Task Types — llm_call, transform, human_input, validate, emit_event, notification (3 batches)

### T02 (COMPLETE)
Structured Agent Output Model

## Next Steps
1. **T09: Execution Viewer** — timeline, event log, artifact panel (consumes T06 events + T07 artifacts)
2. **T13: Backend Implementation** — may need to interleave if search indexing gaps block workflow listing
3. Remaining Phase 1: T10 (YAML Editor), T11 (Run Workflow from UI), T12 (CLI Commands), T14 (Dashboard Widgets)

## Context for Resume
- Phase 0 (Harden the Workflow Core) COMPLETE — T02-T07
- Phase 1 (Foreground MVP) STARTED — T08 complete
- All verification passes: `tsc --noEmit` for sdk/react, sdk/typescript, client-apps/web; `go vet` for codegen tools and sdk/go
- `useExportResource` only supports Agent and McpServer — workflow YAML export is deferred
- Search indexing for workflows in backend is unverified — `list()` may return empty until T13
- `CheckBudgetWarnings()` (from T05) still standalone — NOT wired into `ValidateWorkflow()` yet

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t08-workflow-pages.md
```

### 2. Task Directory
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 3. T08 Key Files Created/Modified
- **SDK hooks (new)**: `sdk/react/src/workflow/useWorkflow.ts`, `useWorkflowList.ts`, `useWorkflowCount.ts`, `useWorkflowInstances.ts`, `useWorkflowExecutionList.ts`
- **SDK components (new)**: `sdk/react/src/workflow/WorkflowDetailView.tsx`, `WorkflowExecutionPhaseBadge.tsx`, `WorkflowTaskList.tsx`
- **Console routes (new)**: `client-apps/web/src/app/workflows/` (4 files)
- **Console domain (new)**: `client-apps/web/src/domain/workflow/` (6 files)
- **Modified**: `Sidebar.tsx`, `scope-persistence.ts`, `useDeleteResource.ts`, `sdk/react/src/index.ts`
- **Codegen**: `tools/codegen/proto2schema/main.go`, `tools/codegen/schemas/services/workflow.json`

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
2. [ ] Review the task plan in `tasks/T01_0_plan.md`
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Execute the next task

## Project Phases

- **Phase 0**: Harden Workflow Core (T02-T07) — COMPLETE
- **Phase 1**: Foreground MVP (T08-T14) — IN PROGRESS (T08 done)
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Plan T09" - Design execution viewer
- "Plan T13" - Design backend implementation
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
