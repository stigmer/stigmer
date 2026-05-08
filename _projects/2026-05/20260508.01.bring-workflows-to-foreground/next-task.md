# Next Task: 20260508.01.bring-workflows-to-foreground

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Bring Workflows to the Foreground

**Description**: Complete the missing AI orchestration layer on top of the existing Temporal + CNCF Serverless Workflow foundation, then surface workflows as a first-class product in Stigmer's UI, CLI, and APIs.

**Goal**: Make workflows a first-class, visible, user-facing product surface — from invisible backend plumbing to durable, observable, deployable agent applications with structured AI outputs, typed task schemas, execution traces, human approval gates, budget controls, and a hybrid editor experience.

**Research Report**: `_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

**Tech Stack**: Protobuf, Go (workflow-runner/Temporal), Java (stigmer-service), TypeScript/React (Web UI), Python (agent-runner/LangGraph), Temporal, CNCF Serverless Workflow

**Components**: Proto APIs (workflow/workflowexecution/workflowinstance/tasks), workflow-runner, stigmer-service, Web UI, CLI, agent-runner, model registry, artifact store

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/README.md`
- **Research Report**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/research.workflow-domain-foreground-strategy/04.report.gpt.md`

### 4. Existing Workflow Protos (the domain being enhanced)
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

1. [ ] Read the latest checkpoint (if any) from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-08
**Current Task**: T01 (Master Plan) — PENDING REVIEW
**Phase**: Phase 0 — Harden the Workflow Core
**Next After Approval**: T02 — Structured Agent Output Model

## Project Phases

- **Phase 0**: Harden Workflow Core (T02-T07) — structured outputs, new task types, schema registry, budgets, event stream, artifact store
- **Phase 1**: Foreground MVP (T08-T14) — UI pages, execution viewer, YAML editor, run from UI, CLI, dashboard
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
