# Next Task: 20260519.01.workflow-runner-typescript-rewrite

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260519.01.workflow-runner-typescript-rewrite

**Description**: Rewrite the Go-based workflow-runner (Zigflow/CNCF Serverless Workflow engine) in TypeScript and merge it into the unified TypeScript runner, eliminating Go from the runner execution tier entirely.
**Goal**: Single TypeScript runner service that handles all three execution types: ExecuteDeepAgent, ExecuteCursor, and ExecuteServerlessWorkflow. Go workflow-runner deleted after validated cutover. All 12 golden YAML workflows passing identically in TypeScript.
**Tech Stack**: TypeScript/Node.js, Temporal TypeScript SDK, jq-wasm (expression evaluation), js-yaml, semver, @grpc/proto-loader, @grpc/grpc-js, Ajv (JSON Schema), openai/anthropic SDKs, @aws-sdk/client-s3, @opentelemetry/api, Vitest

## Current Status

**Created**: 2026-05-19
**Current Task**: Phase 2 — For Task (Iteration)
**Status**: COMPLETE
**Last Session**: 2026-05-20, Session 3

## Session Progress (2026-05-20, Session 3)

### Accomplishments — Phase 2: For Task Implementation
- Implemented the CNCF Serverless Workflow `for` task type — the iteration primitive
- **tasks/for.ts** (236 LOC): `executeForTask()` function + `ForTaskPlaceholderBuilder`
  - Collection evaluation via jq (null input, state vars)
  - `toIterableSlice()` normalization — array, object (key/value pairs), integer (count loop)
  - Per-iteration state cloning from parent snapshot (`state.clone().clearOutput()`)
  - Iteration variable binding via `addData()` into `$data` namespace
  - Optional `while` condition evaluated per iteration after variable binding
  - Nested `do` execution via recursive `executeDoTasks()`
  - Ordered array result aggregation
  - Lazy dynamic import of `executeDoTasks` to break circular dependency
- **do-executor.ts**: Added `for` case to `runSingleTask()` — delegates to `executeForTask()`
- **task-factory.ts**: Registered `for` in factory dispatch with `ForTaskPlaceholderBuilder`
- **22 unit tests** in `__tests__/for.test.ts` covering all behaviors
- **4 loader tests** added to `__tests__/loader.test.ts` for `for` task parsing

### Key Decisions
- **Per-iteration clone from parent (not cumulative)** — Discovered Go implementation clones from the parent snapshot per iteration, NOT cumulative. Each iteration is isolated — mutations from iteration N are NOT visible to iteration N+1. This was initially assumed wrong in the plan and corrected during research.
- **Variables bind into `$data`, not top-level** — `$data.item` / `$data.index`, not `$item` / `$index`. Matched Go runtime behavior, not CNCF spec examples.
- **No `WorkflowState` changes needed** — Variables bind through existing `addData()`. No modifications to `getAsMap()`, `types.ts`, `state.ts`, or `expression.ts`.
- **`exit`/`end` handled identically** — Go treats both the same inside `for` bodies. No termination signal refactor needed for Go parity.
- **Inline execution in do-executor** — `for` is a control-flow construct that wraps `executeDoTasks()`, handled inline like `do`, not through a standalone `TaskBuilder`.
- **T17 parallelism deferred** — `max_parallelism`, `batch_size`, `on_error` require Temporal workflow goroutine semantics. Sequential-only for now.

### Key Findings
- Go's `state.Clone().ClearOutput()` per iteration prevents iteration-order dependencies and enables future parallelism
- CNCF spec examples showing `$pet` as a top-level jq variable are inconsistent with the Go runtime which uses `$data.pet`
- TypeScript `Object.entries()` preserves insertion order (deterministic), unlike Go map iteration (non-deterministic) — documented behavioral difference
- Lazy dynamic import pattern (`await import("../do-executor.js")`) cleanly breaks the circular dependency between for.ts and do-executor.ts

### Files Created/Modified
- **Created**: `backend/services/runner/src/workflow-engine/tasks/for.ts` (236 LOC)
- **Created**: `backend/services/runner/src/workflow-engine/__tests__/for.test.ts` (347 LOC)
- **Modified**: `backend/services/runner/src/workflow-engine/do-executor.ts` (+15 lines)
- **Modified**: `backend/services/runner/src/workflow-engine/task-factory.ts` (+5 lines)
- **Modified**: `backend/services/runner/src/workflow-engine/__tests__/loader.test.ts` (+76 lines)

### Test Results
- 26 new tests (22 for-task unit + 4 loader parsing)
- 988 total tests passing across the entire runner (up from 928)
- `tsc --noEmit` clean
- Zero regressions

## Next Steps

1. **Phase 3: Expression Engine (full)** — Complete jq integration as Temporal local activity, sideEffect wrapping for uuid determinism
2. **Phase 4: External Call Tasks** — call:http, call:grpc, call:llm, call:agent as Temporal activities
3. **Phase 5: Advanced Tasks** — try/catch, wait/listen, emit_event, notification, human_input, fork (parallel)
4. **Phase 6: Supporting Infrastructure** — claimcheck, heartbeat, interceptors, OTel, event emission, budget tracking
5. **Phase 7: Integration Testing** — 12 golden YAMLs passing identically, regression suite

## Context for Resume

- The workflow engine at `src/workflow-engine/` is a self-contained execution kernel with no Temporal coupling in the core modules
- Expression evaluation runs in a local activity (outside the sandbox) — the `ExpressionEvaluator` type in `types.ts` is the contract
- `executeDoTasks()` is the entry point. `for` and `do` tasks are handled inline in the executor via direct dispatch, not through the TaskBuilder factory.
- `executeForTask()` in `tasks/for.ts` is the iteration engine — it clones state per iteration from the parent snapshot, binds item/index into `$data`, evaluates `while`, and delegates to `executeDoTasks()` for the body
- Task builders (`SetTaskBuilder`, `SwitchTaskBuilder`) produce `TaskExecutorFn` closures for non-control-flow tasks
- The loader runs activity-side and produces plain-JSON `WorkflowModel` — no class instances cross the serialization boundary
- Executable task types: `set`, `switch`, `do`, `for`. All others parse but throw at runtime.
- The Go reference implementation is at `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines, 22 packages)
- Golden test YAMLs are at `backend/services/workflow-runner/test/golden/` (12 canonical workflows, 2 use `for`)

## Prior Research

Deep Research (ChatGPT) assessed the rewrite at **~70% confidence**. Key findings:
- CNCF Serverless Workflow TypeScript SDK exists and is actively maintained
- Temporal TypeScript SDK has full parity with Go
- jq is the #1 risk — no native TS implementation, must use jq-wasm (activity-side)
- Dynamic gRPC via `@grpc/proto-loader` is ready
- JSON Schema validation (Ajv) supports Draft 2020-12

Full report: `_projects/2026-05/20260518.01.unified-runner-migration/research.workflow-runner-typescript-rewrite-feasibility/04.report.gpt.md`

## Migration Phases (Full Roadmap)

| Phase | Name | Est. Weeks | Status |
|-------|------|-----------|--------|
| 0 | Validation Spike (T01) — jq, gRPC, CNCF SDK | 0.5 | COMPLETE (CONDITIONAL GO) |
| 1 | Core Engine Scaffold — YAML parsing, task graph builder, expression engine | 2-3 | **COMPLETE** (119 tests, 3,147 LOC) |
| 2 | Simple Task Types — for, nested iteration | 1-2 | **COMPLETE** (26 tests, 583 LOC) |
| 3 | Expression Engine (full) — local activity integration, sideEffect | 1-2 | Blocked on Phase 1 (now unblocked) |
| 4 | External Call Tasks — call_http, call_grpc, call_llm, call_agent | 3-4 | Blocked on Phase 2 (now unblocked) |
| 5 | Advanced Tasks — try/catch, wait/listen, emit_event, notification, human_input, fork | 2-3 | Blocked on Phase 2 (now unblocked) |
| 6 | Supporting Infrastructure — claimcheck, heartbeat, interceptors, OTel | 2-3 | Blocked on Phase 4 |
| 7 | Integration Testing — 12 golden YAMLs, regression suite | 3-4 | Blocked on Phase 5 |
| 8 | Deployment & Cutover — Docker, CI, gradual rollout | 2-3 | Blocked on Phase 7 |
| 9 | Cleanup — Delete Go workflow-runner, update CI | 1 | Blocked on Phase 8 |

## Key References

- **Go workflow-runner**: `backend/services/workflow-runner/` (~19K lines, 22 packages)
- **Zigflow engine core**: `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines)
- **Go for-task reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_for.go` (604 lines)
- **Golden test YAMLs**: `backend/services/workflow-runner/test/golden/` (12 canonical workflows)
- **Runtime expressions**: `backend/services/workflow-runner/pkg/utils/runtime_expressions.go`
- **Unified runner project**: `_projects/2026-05/20260518.01.unified-runner-migration/`
- **PoC results**: `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/poc/results/`
- **TS workflow engine**: `backend/services/runner/src/workflow-engine/`

---

*This file provides direct paths to all project resources for quick context loading.*
