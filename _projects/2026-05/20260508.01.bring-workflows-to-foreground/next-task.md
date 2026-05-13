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
**Last Session**: 2026-05-13 — T13 COMPLETE (Phase 1 continues)
**Current Task**: T13 COMPLETE — P0 Task Types Backend Implementation (Go)
**Phase**: Phase 1 — Foreground MVP — IN PROGRESS
**Next Task**: T10 (YAML Editor) or T13b (Java/Cloud Parity)

## Session Progress (2026-05-13, T13)

### T13: P0 Task Types — Backend Implementation (Go) — COMPLETE

Implemented runtime execution for 6 new P0 task types in the Go workflow-runner,
plus shared infrastructure (budget tracker, event emitter, LLM provider abstraction,
notification provider interface). 20 new files, 5 modified. All existing tests pass.

#### T13.1: Foundation — Converter Pipeline + Shared Infrastructure
- 6 new call function constants in `constants.go`
- `NewTaskBuilder` factory dispatches to 6 new builders
- 6 new converter methods in `task_converters.go` + dispatch entries in `proto_to_yaml.go`
- `pkg/budget/tracker.go` — budget accumulator (cost, tokens, duration)
- `pkg/events/emitter.go` — typed event builder with auto-incrementing sequences
- Added deps: `santhosh-tekuri/jsonschema/v6`, `sashabaranov/go-openai`, `liushuangls/go-anthropic/v2`

#### T13.2: transform Task
- `task_builder_transform.go` + `task_builder_transform_activities.go`
- JQ engine via `gojq`, Go `text/template` engine, JSONata returns UNIMPLEMENTED

#### T13.3: validate Task
- `task_builder_validate.go` + `task_builder_validate_activities.go`
- JSON Schema validation via `jsonschema/v6`, business rules via JQ boolean expressions
- on_fail policies: RAISE (fail), BRANCH (fallback_task via `__stigmer_branch_override`), WARN (continue)

#### T13.4: emit_event Task
- `task_builder_emit_event.go` + `task_builder_emit_event_activities.go`
- Constructs full CloudEvents envelope (id, specversion, type, source, time, data)
- Cross-workflow delivery deferred to Phase 2

#### T13.5: notification Task
- `task_builder_notification.go` + `task_builder_notification_activities.go`
- `pkg/notification/provider.go` — NotificationProvider interface
- `pkg/notification/webhook.go` — Webhook provider (POST to recipient URLs)
- Other channels (Slack, email) return descriptive UNIMPLEMENTED error

#### T13.6: llm_call Task
- `task_builder_call_llm.go` + `task_builder_call_llm_activities.go`
- `pkg/llm/provider.go` — LLMProvider interface
- `pkg/llm/openai.go` — OpenAI provider (ChatCompletion, structured output via json_object)
- `pkg/llm/anthropic.go` — Anthropic provider (Messages API)
- `pkg/llm/registry.go` — Prefix-based model resolution (gpt-*/o1*/o3* → OpenAI, claude-* → Anthropic)
- Structured output validation + on_invalid retry logic (re-prompt with errors)
- JIT API key resolution from runtime environment (OPENAI_API_KEY, ANTHROPIC_API_KEY)

#### T13.7: human_input Task
- `task_builder_human_input.go` — Temporal signal-based approval gate
- Signal channel: `human_input_{task_name}`, payload: outcome + form_data + reviewer
- Timeout handling via Temporal timer + `workflow.NewSelector`
- 4 timeout policies: FAIL, AUTO_APPROVE, AUTO_DENY, ESCALATE
- Custom outcomes with `then` routing via `__stigmer_branch_override`
- Binary approve/deny when no custom outcomes defined

#### T13.8: Branch Override + Budget Wiring
- Modified `DoTaskBuilder.runTask` to return optional branch override from task output
- Modified `DoTaskBuilder.iterateTasks` to apply `__stigmer_branch_override` before static flow directives
- Budget tracker + event emitter infrastructure ready for integration

#### Verification
- `go build ./...` — clean
- `go vet ./...` — clean
- `go test ./pkg/...` — all existing tests pass (zero regressions)

#### Open Items for Future Sessions
- Event emission integration — emitter built, wiring into updateStatus RPC deferred
- Budget enforcement at task boundaries — tracker built, integration into iterateTasks deferred
- stigmer-server signal routing for human_input submitWorkflowApproval
- Java/Cloud parity (T13b)

## Previous Session Progress (2026-05-13, T09)

### T09: Workflow Execution Viewer — COMPLETE

Built the full Execution Viewer following SDK-first architecture (DD-001): event store, data hooks, behavior hooks, styled components (timeline, task panel, cost panel, artifact panel, approval card), and console page shells. 17 new files, 4 modified.

#### Layer 0: Event Store — WorkflowExecutionEventStore
- Append-only external store for `useSyncExternalStore`
- Derived selectors: `getTaskStates()`, `getCostSummary()`, stream state FSM
- Simpler than ConversationStore — no structural sharing needed (events are immutable)

#### Layer 1: SDK Data Hooks (3 new files)
- `useWorkflowExecution` — single execution by ID
- `useWorkflowExecutionEventLog` — paginated event log with cursor, type, and task filters
- `useWorkflowExecutionArtifacts` — artifacts via `listByExecution()`

#### Layer 2: SDK Behavior Hooks (2 new files)
- `useWorkflowExecutionEventStream` — live `subscribeEvents` + batch `getEventLog` fallback + UNIMPLEMENTED graceful handling
- `useWorkflowExecutionActions` — cancel/terminate/pause/resume/recover/submitApproval

#### Layer 3: SDK Styled Components (8 new files)
- `WorkflowExecutionViewer` (composed top-level), `WorkflowExecutionHeader`, `WorkflowExecutionTimeline` (auto-scroll via IntersectionObserver), `WorkflowExecutionTimelineEvent` (18 event type renderers), `WorkflowExecutionApprovalCard`, `WorkflowExecutionTaskPanel`, `WorkflowExecutionCostPanel`, `WorkflowExecutionArtifactPanel`

#### Layer 4: Console Pages
- Route: `/workflows/executions/[id]`
- Execution list rows now clickable

#### Decisions
- DD-T09-001: Two-region layout (timeline + sidebar), not three-pane
- DD-T09-002: No rAF coalescing (low-frequency events)
- DD-T09-003: Agent drill-down via navigation callback
- DD-T09-004: Append-only event store with memoized derived selectors
- BigInt compatibility: `BigInt(0)` instead of `0n` for ES target compat

## Previous Sessions

### T08 (COMPLETE — 2026-05-12)
Workflow List and Detail Pages — codegen fix, React SDK data hooks, styled components (WorkflowDetailView, PhaseBadge, TaskList), web console pages, sidebar navigation, barrel exports

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
1. **T10: YAML Editor with Graph Preview** — schema-aware editor with live topology graph
2. **T11: Run Workflow from UI** — input form auto-generated from schema, start/cancel/watch
3. **T12: CLI Parity** — `stigmer workflow list/get/validate/apply/diff/run/logs/trace/cancel/resume`
4. **T13b: Java/Cloud Backend Parity** — implement matching task types in stigmer-service (Java)
5. **T14: Dashboard Integration** — pending approvals, failed runs, cost charts

## Context for Resume
- Phase 0 (Harden the Workflow Core) COMPLETE — T02-T07
- Phase 1 (Foreground MVP) IN PROGRESS — T08, T09 complete
- All verification passes: `tsc --noEmit` for sdk/react, sdk/typescript, client-apps/web
- `useExportResource` only supports Agent and McpServer — workflow YAML export deferred
- Search indexing for workflows in backend unverified — `list()` may return empty until T13
- `CheckBudgetWarnings()` (T05) still standalone — NOT wired into `ValidateWorkflow()` yet
- Backend RPCs `subscribeEvents`, `getEventLog`, `submitApproval`, `getDownloadUrl` — viewer handles UNIMPLEMENTED gracefully

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-13-t09-execution-viewer.md
```

### 2. Task Directory
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 3. T09 Key Files Created/Modified
- **Event store (new)**: `sdk/react/src/internal/store/workflow-execution-event-store.ts`
- **SDK data hooks (new)**: `sdk/react/src/workflow/useWorkflowExecution.ts`, `useWorkflowExecutionEventLog.ts`, `useWorkflowExecutionArtifacts.ts`
- **SDK behavior hooks (new)**: `sdk/react/src/workflow/useWorkflowExecutionEventStream.ts`, `useWorkflowExecutionActions.ts`
- **SDK components (new)**: `sdk/react/src/workflow/WorkflowExecutionViewer.tsx`, `WorkflowExecutionHeader.tsx`, `WorkflowExecutionTimeline.tsx`, `WorkflowExecutionTimelineEvent.tsx`, `WorkflowExecutionApprovalCard.tsx`, `WorkflowExecutionTaskPanel.tsx`, `WorkflowExecutionCostPanel.tsx`, `WorkflowExecutionArtifactPanel.tsx`
- **Console route (new)**: `client-apps/web/src/app/workflows/executions/[id]/page.tsx`
- **Console page (new)**: `client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx`
- **Modified**: `WorkflowExecutionListPage.tsx` (clickable rows), `sdk/react/src/workflow/index.ts`, `sdk/react/src/index.ts`, `sdk/react/src/internal/store/index.ts`

### 4. Existing Workflow Protos (the domain being enhanced)
- **Workflow spec**: `apis/ai/stigmer/agentic/workflow/v1/spec.proto`
- **Workflow execution**: `apis/ai/stigmer/agentic/workflowexecution/v1/`
- **Workflow tasks**: `apis/ai/stigmer/agentic/workflow/v1/tasks/`
- **Artifact store**: `apis/ai/stigmer/agentic/artifact/v1/`

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
- **Phase 1**: Foreground MVP (T08-T14) — IN PROGRESS (T08, T09 done)
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Plan T10" - Design YAML editor
- "Plan T13" - Design backend implementation
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
