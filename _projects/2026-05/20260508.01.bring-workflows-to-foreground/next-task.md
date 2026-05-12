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
**Last Session**: 2026-05-12 — T04 COMPLETE (all batches)
**Current Task**: T04 COMPLETE — ready for T05 (Budget Primitives)
**Phase**: Phase 0 — Harden the Workflow Core
**Next Task**: T05 (Budget Primitives)

## Session Progress (2026-05-12, T04)

### T04: Task Schema Registry — COMPLETE

Implemented a machine-readable registry of all 19 workflow task kinds enabling YAML editor autocomplete, UI form generation, CLI validation, task palette rendering, and documentation generation.

#### Batch 1: Proto + Sidecar + Pipeline
- **TaskKindDescriptor proto**: New `task_kind_descriptor.proto` with `TaskKindDescriptor`, `TaskFieldDescriptor`, `TaskFieldGroup` messages and `TaskKindCategory`, `TaskFieldType` enums
- **TaskKindRegistryQueryController proto**: Separate service proto with `getTaskKindRegistry` RPC
- **19 sidecar YAML files**: `apis/.../tasks/meta/*.yaml` with display names, categories, icons, field groups, output schemas, YAML examples
- **Generator extension**: New `--target=task-registry` with `--meta-dir` flag in `tools/codegen/generator/task_registry.go`
- **Generated registry**: `task-kind-registry.json` (85KB, 19 descriptors with full field info + per-kind JSON Schemas)

#### Batch 2: API + SDK + Validation
- **Java HTTP endpoint**: `TaskKindRegistryController.java` in stigmer-cloud — serves classpath JSON at `/v1/proxy/task-kind-registry` with 1h cache
- **Go HTTP endpoint**: `backend/services/stigmer-server/pkg/domain/workflow/registry/` — embed.FS-based, wired into unified HTTP handler
- **Cross-task reference validation**: `crossref.go` validates fallback_task, cases[].then, outcomes[].then with Levenshtein "did you mean?" suggestions. 5 tests passing.
- **SDK hook**: `useTaskKindRegistry()` in `sdk/react/src/workflow/` with `getByKind()`, `getJsonSchema()`, `categories` helpers. TypeScript compiles cleanly.

#### Key Design Decisions
- **D1**: Proto-derived + sidecar hybrid — structural schema from proto2schema, presentation from YAML
- **D2**: Client-side focus — cross-reference validation added (Layer 2 after buf.validate), primary output is client-consumable metadata
- **D3**: Custom proto + derived JSON Schema — `TaskKindDescriptor` proto as canonical shape, JSON Schema derived for Monaco/RJSF

## Previous Sessions

### T03 (COMPLETE — 2026-05-12)
| Batch | Task Types | Enum Values | Commit |
|-------|-----------|-------------|--------|
| 1 | llm_call + transform | 14, 15 | `417ee6042` |
| 2 | human_input + validate | 16, 17 | `0163c9866` |
| 3 | emit_event + notification | 18, 19 | `9b877d51b` |

### T02 (COMPLETE)
- Structured Agent Output Model

## Next Steps
1. T05: Budget Primitives — add workflow-level budget controls (token limits, cost guards, execution caps)
2. After T05: T06 (Event Stream) and T07 (Artifact Store) to complete Phase 0
3. After Phase 0: Phase 1 — Foreground MVP (UI pages, execution viewer, YAML editor)

## Context for Resume
- T04 is fully complete — all deliverables implemented across both batches
- Proto stubs for `task_kind_descriptor.proto` and `task_kind_registry_query.proto` need regeneration (run `make protos`)
- stigmer-cloud `TaskKindRegistryController.java` created but `task-kind-registry.json` classpath resource needs to be generated and placed
- `gopkg.in/yaml.v3` added to `tools/go.mod` for sidecar YAML parsing (already in MODULE.bazel)
- Cross-reference validation wired into `ValidateWorkflow()` as Layer 2 — validates fallback_task, then, outcome.then
- SDK hook follows `useModelRegistry` pattern — context-based with `TaskKindRegistryContext`

## Essential Files to Review

### 1. T04 Plan (complete — all deliverables implemented)
```
/Users/suresh/.cursor/plans/t04_task_schema_registry_2bbc1405.plan.md
```

### 2. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/checkpoints/2026-05-12-t04-task-schema-registry.md
```

### 3. Task Directory
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/tasks/
```

### 4. T04 New Files (key files created)
- **Proto**: `apis/ai/stigmer/agentic/workflow/v1/task_kind_descriptor.proto`
- **Proto**: `apis/ai/stigmer/agentic/workflow/v1/task_kind_registry_query.proto`
- **Sidecars**: `apis/ai/stigmer/agentic/workflow/v1/tasks/meta/*.yaml` (19 files)
- **Generator**: `tools/codegen/generator/task_registry.go`
- **Go handler**: `backend/services/stigmer-server/pkg/domain/workflow/registry/`
- **Validation**: `backend/services/workflow-runner/pkg/validation/crossref.go`
- **SDK hook**: `sdk/react/src/workflow/`
- **Java controller**: (stigmer-cloud) `TaskKindRegistryController.java`

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
2. [ ] Review the T05 plan in `tasks/` (needs to be created)
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Execute T05

## Project Phases

- **Phase 0**: Harden Workflow Core (T02-T07) — structured outputs, new task types, schema registry, budgets, event stream, artifact store
- **Phase 1**: Foreground MVP (T08-T14) — UI pages, execution viewer, YAML editor, run from UI, CLI, dashboard
- **Phase 2**: Visual Builder (T15) — canvas editor, drag-and-drop, YAML round-trip
- **Phase 3**: AI-Assisted Creation (T16) — NL-to-workflow, chat-to-workflow, repair assistant
- **Phase 4**: Advanced Agentic Orchestration (T17) — plan_and_execute, handoff, eval, batch, cache, code_execution, memory

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Plan T05" - Design Budget Primitives
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
