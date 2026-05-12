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
**Last Session**: 2026-05-12 — T07 COMPLETE (Phase 0 COMPLETE)
**Current Task**: T07 COMPLETE — Phase 0 finished, ready for Phase 1
**Phase**: Phase 0 — Harden the Workflow Core — COMPLETE
**Next Task**: Phase 1 begins — T08 (Workflow Pages) or T09 (Execution Viewer)

## Session Progress (2026-05-12, T07)

### T07: Artifact Store Integration — COMPLETE

Designed and implemented the full Artifact Store proto contract — a shared, first-class resource model for persisting large execution outputs outside of Temporal history, with content-addressable blob storage, retrieval RPCs, automatic size-based promotion, and retention policies.

#### New Proto Package: `apis/ai/stigmer/agentic/artifact/v1/`
- **`api.proto`**: `Artifact` resource (api_version + kind + metadata + spec + status), `ArtifactStatus` (content_hash, size_bytes, storage_state, expires_at)
- **`spec.proto`**: `ArtifactSpec` (content_type, display_name, source, retention), `ArtifactSource`, `RetentionPolicy`
- **`enum.proto`**: `ArtifactStorageState` (pending → stored → deleted)
- **`io.proto`**: `ArtifactId`, `ArtifactList`, `CreateArtifactInput` (50MB max), `ListArtifactsByExecutionRequest`, `ArtifactDownloadUrl`
- **`query.proto`**: `ArtifactQueryController` — `get`, `listByExecution`, `getDownloadUrl`
- **`command.proto`**: `ArtifactCommandController` — `create`, `delete`

#### ApiResourceKind Registration
- Added `artifact = 55` (prefix: "art", tier: open_source, org-scoped authorization)

#### Execution Model Extensions
- Added `artifact_created = 53` event type + `ArtifactCreatedPayload` to `event.proto`
- Added `repeated string artifact_ids = 11` to `WorkflowTask` in `api.proto`

#### Key Design Decisions
- **Shared bounded context**: Artifacts are first-class resources, not sub-resources
- **No `artifact_store` task kind**: Persistence is infrastructure, not computation
- **Content-addressable storage**: SHA-256 hash-based blob storage for dedup and safe GC
- **OSS: filesystem, Cloud: S3**: Metadata in DB, blobs on object storage
- **Auto-promotion at 256KB**: Transparent to workflow authors

## Previous Sessions

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
1. Phase 1 begins — Foreground MVP (T08-T14)
2. T08: Workflow Pages — list/detail pages in web console
3. T09: Execution Viewer — timeline, event log, artifact panel (consumes T06 events + T07 artifacts)
4. T13: Backend Implementation — artifact repository, blob store, auto-promotion logic, GC

## Context for Resume
- Phase 0 (Harden the Workflow Core) is now COMPLETE — all tasks T02-T07 done
- T07 is proto-only (contract definition); backend implementation is deferred to T13
- Artifact SDK clients generated across Go, TS, Python, Java
- All codegen pipelines run cleanly (both `make codegen` in stigmer and `make protos` in stigmer-cloud)
- `buf lint`, `buf breaking`, Go vet, TS typecheck all pass cleanly
- `CheckBudgetWarnings()` (from T05) is still standalone — NOT wired into `ValidateWorkflow()` yet

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t07-artifact-store.md
```

### 2. Task Directory
```
_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 3. T07 Key Files Created/Modified
- **Proto (new)**: `apis/ai/stigmer/agentic/artifact/v1/` (6 proto files)
- **Proto (modified)**: `apis/ai/stigmer/agentic/workflowexecution/v1/event.proto` (artifact_created event)
- **Proto (modified)**: `apis/ai/stigmer/agentic/workflowexecution/v1/api.proto` (artifact_ids on WorkflowTask)
- **Proto (modified)**: `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` (artifact kind)

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
- **Phase 1**: Foreground MVP (T08-T14) — UI pages, execution viewer, YAML editor, run from UI, CLI, dashboard
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Plan T08" or "Plan T09" - Design next Phase 1 task
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
