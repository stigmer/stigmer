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
**Last Session**: 2026-05-12 — T03 COMPLETE (all 3 batches)
**Current Task**: T03 COMPLETE — choosing next task
**Phase**: Phase 0 — Harden the Workflow Core
**Next Task**: T04 (Task Schema Registry) or T05 (Budget Primitives) — decision pending

## Session Progress (2026-05-12)

### T03 Batch 3 (latest)
- `emit_event` (enum 18) + `notification` (enum 19) complete
- `EmitEventSpec` sub-message with CloudEvents envelope (type, source, data, subject)
- `NotificationTaskConfig` with 6 fields (channel, recipients, subject, body, template, metadata)
- First `map<string, string>` field in task configs (notification.metadata)
- No new policy enums — structurally simplest batch
- Commit: `9b877d51b feat(apis/workflow): add emit_event and notification task types (T03 Batch 3)`

### T03 Batch 2
- `human_input` (enum 16) + `validate` (enum 17)
- `HumanInputTimeoutPolicy` enum local to `human_input.proto`
- `ValidationFailPolicy` enum local to `validate.proto`
- Commit: `0163c9866 feat(apis/workflow): add human_input and validate task types (T03 Batch 2)`

### T03 Batch 1
- `llm_call` (enum 14) + `transform` (enum 15)
- Extracted `OnInvalidOutputPolicy` to shared `common.proto`
- Commit: `417ee6042 feat(apis/workflow): add llm_call and transform task types (T03 Batch 1)`

### Earlier
- T02 complete: Structured Agent Output Model
- T03 plan written with 3 batches of 6 new task types
- Design decisions: keep `transform`, defer `extract`, enhance `for_each` instead of `batch`

## T03 Summary (COMPLETE)

| Batch | Task Types | Enum Values | Commit |
|-------|-----------|-------------|--------|
| 1 | llm_call + transform | 14, 15 | `417ee6042` |
| 2 | human_input + validate | 16, 17 | `0163c9866` |
| 3 | emit_event + notification | 18, 19 | `9b877d51b` |

Total: 6 new task types added, 19 task kinds total (up from 13).

## Next Steps
1. Choose between T04 (Task Schema Registry) or T05 (Budget Primitives)
2. T04 would formalize task config schemas into a registry for UI form generation, validation, and documentation
3. T05 would add workflow-level budget primitives (token limits, cost guards, execution caps)
4. After Phase 0 remaining tasks: T06 (Event Stream) and T07 (Artifact Store)

## Context for Resume
- T03 is fully complete — all 6 new task types committed across 3 batches
- 19 task kinds now in `WorkflowTaskKind` enum (enum.proto)
- All stubs regenerated in stigmer repo (Go, Java, Python, TS, Dart, MCP, SDK)
- stigmer-cloud stubs are regenerated but not committed yet (commit separately if needed)
- Shared enums: `OnInvalidOutputPolicy` in `common.proto` (used by agent_call and llm_call)
- Local enums: `HumanInputTimeoutPolicy` (human_input.proto), `ValidationFailPolicy` (validate.proto), `TransformEngine` (transform.proto)
- No enums needed for emit_event or notification

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t03-batch3-emit-event-notification.md
```

### 2. T03 Plan (complete — all batches delivered)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/T03_0_plan.md
```

### 3. Task Directory
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 4. All Task Type Protos (T03 complete set)
- **common.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/common.proto` — shared OnInvalidOutputPolicy enum
- **llm_call.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/llm_call.proto` — LlmCallTaskConfig
- **transform.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/transform.proto` — TransformTaskConfig + TransformEngine
- **human_input.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/human_input.proto` — HumanInputTimeoutPolicy + HumanInputOutcome + HumanInputTaskConfig
- **validate.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/validate.proto` — ValidationFailPolicy + ValidationRule + ValidateTaskConfig
- **emit_event.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/emit_event.proto` — EmitEventSpec + EmitEventTaskConfig
- **notification.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/notification.proto` — NotificationTaskConfig
- **agent_call.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto` — imports from common.proto

### 5. Existing Workflow Protos (the domain being enhanced)
- **Workflow spec**: `apis/ai/stigmer/agentic/workflow/v1/spec.proto`
- **Workflow enum**: `apis/ai/stigmer/agentic/workflow/v1/enum.proto`
- **Workflow tasks**: `apis/ai/stigmer/agentic/workflow/v1/tasks/`
- **WorkflowExecution spec**: `apis/ai/stigmer/agentic/workflowexecution/v1/spec.proto`
- **WorkflowExecution enum**: `apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto`
- **WorkflowInstance spec**: `apis/ai/stigmer/agentic/workflowinstance/v1/spec.proto`
- **Serverless validation**: `apis/ai/stigmer/agentic/workflow/v1/serverless/validation.proto`

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
2. [ ] Review the task plan for the next task (T04 or T05)
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
- "Plan T04" - Design Task Schema Registry
- "Plan T05" - Design Budget Primitives
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
