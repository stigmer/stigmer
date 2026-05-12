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
**Last Session**: 2026-05-12 — OSS library/visibility + T03 plan (see changelog)
**Current Task**: T03 — Plan APPROVED, ready for execution (Batch 1 next)
**Phase**: Phase 0 — Harden the Workflow Core
**Next Task**: T03 Batch 1 (llm_call + transform)

## Session Progress (2026-05-12)
- T02 complete (prior session): Structured Agent Output Model
- T03 plan written with 3 batches of 6 new task types
- Design decisions documented: keep `transform`, defer `extract`, enhance `for_each` instead of `batch`
- T03 plan at: `tasks/T03_0_plan.md`

### OSS (same branch — committed 2026-05-12)
- **Changelog**: `_changelog/2026-05/2026-05-12-132429-library-visibility-scope-and-workflow-t03-plan.md`
- **Checkpoint**: `checkpoints/2026-05-12-session-oss-library-and-t03.md`
- Unified library resource detail headers: `McpServerDetailView` → `ResourceDetailShell` (`headerBanner`, `headerMetaExtra`, `nameElement`, `qualifiedSlug`).
- `VisibilityToggle`: lock/globe icons + clearer private-selected styling.
- Library scope: `ScopeToggle` checkbox pattern; desktop list scope persistence (`scope-persistence.ts`); pickers + `SessionComposer` scope wiring.

## Next Steps
1. Pick up T03 Batch 1: `llm_call` (enum 14) + `transform` (enum 15) — proto + codegen + validation wiring
2. Then T03 Batch 2: `human_input` (enum 16) + `validate` (enum 17)
3. Then T03 Batch 3: `emit_event` (enum 18) + `notification` (enum 19)
4. After all T03 batches: T04 (Task Schema Registry) or T05 (Budget Primitives)

## Context for Resume
- T02 proto contract is finalized and all stubs are regenerated across both repos
- T03 plan defines 6 new task types in 3 batches (2 types per batch)
- Design decisions: keep `transform` (distinct from `set_vars`), defer `extract` (covered by `llm_call` + `transform`), enhance `for_each` instead of adding `batch`
- Each batch is independently deliverable and reviewable
- Validation warning is live in the Go runner but runtime enforcement (actual schema validation at execution time) is NOT yet implemented
- stigmer-cloud repo also has regenerated stubs (committed separately if needed)

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t02-structured-agent-output.md
```

### 2. T03 Plan (NEW — read this first)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/T03_0_plan.md
```

### 3. Task Directory
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/README.md`
- **Research Report**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

### 4. Key Proto (just changed)
- **agent_call.proto**: `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto` — now has `AgentCallOutputContract`, `OnInvalidOutputPolicy`, and `output` field

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

1. [ ] Read the T03 plan from `tasks/T03_0_plan.md`
2. [ ] Check which batch to pick up next (Batch 1 → 2 → 3)
3. [ ] Read the latest checkpoint from `checkpoints/`
4. [ ] Review any design decisions in `design-decisions/`
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
7. [ ] Execute the next batch

## Project Phases

- **Phase 0**: Harden Workflow Core (T02-T07) — structured outputs, new task types, schema registry, budgets, event stream, artifact store
- **Phase 1**: Foreground MVP (T08-T14) — UI pages, execution viewer, YAML editor, run from UI, CLI, dashboard
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Start T03 Batch 1" - Implement llm_call + transform protos
- "Start T03 Batch 2" - Implement human_input + validate protos
- "Start T03 Batch 3" - Implement emit_event + notification protos
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
