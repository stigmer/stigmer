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
**Last Session**: 2026-05-12 — T03 Batch 1 Complete
**Current Task**: T03 — Batch 1 COMPLETE, Batch 2 next
**Phase**: Phase 0 — Harden the Workflow Core
**Next Task**: T03 Batch 2 (human_input + validate)

## Session Progress (2026-05-12)
- T03 Batch 1 complete: `llm_call` (enum 14) + `transform` (enum 15)
- Extracted `OnInvalidOutputPolicy` to shared `common.proto`
- All stubs regenerated across both repos (stigmer + stigmer-cloud)
- Commit: `417ee6042 feat(apis/workflow): add llm_call and transform task types (T03 Batch 1)`
- Changelog: `_changelog/2026-05/2026-05-12-140456-llm-call-transform-task-types.md`

### Prior Progress (same day)
- T02 complete: Structured Agent Output Model
- T03 plan written with 3 batches of 6 new task types
- Design decisions: keep `transform`, defer `extract`, enhance `for_each` instead of `batch`

## Next Steps
1. Pick up T03 Batch 2: `human_input` (enum 16) + `validate` (enum 17) — proto + codegen + validation wiring
2. Then T03 Batch 3: `emit_event` (enum 18) + `notification` (enum 19)
3. After all T03 batches: T04 (Task Schema Registry) or T05 (Budget Primitives)

## Context for Resume
- T03 Batch 1 is committed and all stubs regenerated
- `OnInvalidOutputPolicy` now lives in `common.proto` (shared by agent_call and llm_call)
- T03 plan at `tasks/T03_0_plan.md` has full specs for Batch 2 and Batch 3
- `human_input` is the most complex proto in T03 (multi-party, timeout-aware, form-driven)
- `validate` is simpler (schema + rules validation with fail/branch/warn policies)
- Batch 2 will need a new `HumanInputTimeoutPolicy` enum and `ValidationFailPolicy` enum
- Consider whether those go in `common.proto` or stay local (timeout policy is specific to human_input; validation fail policy follows the same pattern as OnInvalidOutputPolicy)
- stigmer-cloud stubs are regenerated but not committed yet (commit separately if needed)

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t03-batch1-llm-call-transform.md
```

### 2. T03 Plan (read this for Batch 2 specs)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/T03_0_plan.md
```

### 3. Task Directory
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 4. Key Protos (just changed in Batch 1)
- **common.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/common.proto` — shared OnInvalidOutputPolicy enum
- **llm_call.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/llm_call.proto` — LlmCallTaskConfig
- **transform.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/transform.proto` — TransformTaskConfig + TransformEngine
- **agent_call.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto` — now imports from common.proto

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

1. [ ] Read the T03 plan from `tasks/T03_0_plan.md` (Batch 2 section)
2. [ ] Read the latest checkpoint from `checkpoints/`
3. [ ] Review Batch 1 protos as patterns for Batch 2
4. [ ] Review any design decisions in `design-decisions/`
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
7. [ ] Execute Batch 2

## Project Phases

- **Phase 0**: Harden Workflow Core (T02-T07) — structured outputs, new task types, schema registry, budgets, event stream, artifact store
- **Phase 1**: Foreground MVP (T08-T14) — UI pages, execution viewer, YAML editor, run from UI, CLI, dashboard
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Start T03 Batch 2" - Implement human_input + validate protos
- "Start T03 Batch 3" - Implement emit_event + notification protos
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
