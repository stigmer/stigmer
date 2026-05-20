# Next Task: 20260519.01.workflow-runner-typescript-rewrite

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260519.01.workflow-runner-typescript-rewrite

**Description**: Rewrite the Go-based workflow-runner (Zigflow/CNCF Serverless Workflow engine) in TypeScript and merge it into the unified TypeScript runner, eliminating Go from the runner execution tier entirely.
**Goal**: Single TypeScript runner service that handles all three execution types: ExecuteDeepAgent, ExecuteCursor, and ExecuteServerlessWorkflow. Go workflow-runner deleted after validated cutover. All 12 golden YAML workflows passing identically in TypeScript.
**Tech Stack**: TypeScript/Node.js, Temporal TypeScript SDK, jq-wasm (expression evaluation), js-yaml, semver, @grpc/proto-loader, @grpc/grpc-js, Ajv (JSON Schema), openai/anthropic SDKs, @aws-sdk/client-s3, @opentelemetry/api, Vitest

## Current Status

**Created**: 2026-05-19
**Current Task**: Phase 4 — External Call Tasks
**Status**: NOT STARTED
**Last Session**: 2026-05-20, Session 4

## Session Progress (2026-05-20, Session 4)

### Accomplishments — Phase 3: Expression Engine Temporal Integration
- Wired jq-wasm expression engine into Temporal as a local activity
- **activities/evaluate-expressions.ts**: Factory wrapping `evaluateExpressionBatch` for deterministic replay
- **workflows/execute-serverless-workflow.ts**: Temporal workflow `"stigmer/workflow/execute"` with full data pipeline
  - `proxyLocalActivities` proxy for expression evaluation
  - Workflow-level `input.from` transform
  - Workflow-level `output.as` transform
  - State initialization with env vars
- **do-executor.ts**: Added `resolveTaskInput()` for task-level `input.from` processing
- **Registration**: Workflow in `workflows/index.ts`, activity in `main.ts`
- **24 new tests**: 8 activity unit + 11 workflow integration + 5 input.from

### Key Decisions
- **Local activity IS the determinism boundary** — no separate sideEffect needed; results recorded in history, replayed without re-execution. More correct than Go which only wraps Set tasks.
- **Single generic workflow type** — `"stigmer/workflow/execute"` receives WorkflowModel as input. No per-definition dynamic registration.
- **Kernel already sandbox-safe** — Phase 2 correctly routed all expression evaluation through the injected ExpressionEvaluator. No refactoring needed.
- **Set tasks ignore effective input** — evaluate with null as jq input, access data through state variables ($context, $data, etc.). Matches Go behavior.

### Key Findings
- `proxyLocalActivities` with ~1ms overhead is perfect for high-frequency jq evaluation calls
- The kernel module graph has zero Node.js transitive dependencies — only `expression.ts` touches node:crypto and jq-wasm
- Temporal workflow bundler should handle kernel imports since they're pure TS with no Node.js deps (verified via `tsc --noEmit`)

### Files Created/Modified
- **Created**: `backend/services/runner/src/activities/evaluate-expressions.ts`
- **Created**: `backend/services/runner/src/workflows/execute-serverless-workflow.ts`
- **Created**: `backend/services/runner/src/activities/__tests__/evaluate-expressions.test.ts` (8 tests)
- **Created**: `backend/services/runner/src/workflows/__tests__/execute-serverless-workflow.test.ts` (11 tests)
- **Modified**: `backend/services/runner/src/workflow-engine/do-executor.ts` (+40 lines)
- **Modified**: `backend/services/runner/src/workflows/index.ts` (+4 lines)
- **Modified**: `backend/services/runner/src/main.ts` (+3 lines)

### Test Results
- 24 new tests (8 activity + 11 workflow + 5 input.from in do-executor)
- 1045 total tests passing across the entire runner
- `tsc --noEmit` clean
- Zero regressions

## Next Steps

1. **Phase 4: External Call Tasks** — call:http, call:grpc, call:llm, call:agent as Temporal activities
2. **Phase 5: Advanced Tasks** — try/catch, wait/listen, emit_event, notification, human_input, fork (parallel)
3. **Phase 6: Supporting Infrastructure** — claimcheck, heartbeat, interceptors, OTel, event emission, budget tracking
4. **Phase 7: Integration Testing** — 12 golden YAMLs passing identically, regression suite

## Context for Resume

- The workflow engine at `src/workflow-engine/` is a sandbox-safe execution kernel with zero Node.js dependencies
- Expression evaluation runs in a local activity (`activities/evaluate-expressions.ts`) — the kernel calls it via the injected `ExpressionEvaluator` callback
- The Temporal workflow `"stigmer/workflow/execute"` lives at `workflows/execute-serverless-workflow.ts`
- `executeDoTasks()` is the kernel entry point. `for` and `do` are handled inline; `set` and `switch` go through TaskBuilder
- Task-level `input.from` is resolved in `do-executor.ts` via `resolveTaskInput()` before task dispatch
- Workflow-level `input.from` and `output.as` are handled in the workflow function itself
- The Go reference implementation is at `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines, 22 packages)
- Golden test YAMLs are at `backend/services/workflow-runner/test/golden/` (12 canonical workflows)
- Executable task types: `set`, `switch`, `do`, `for`. All others parse but throw at runtime.

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
| 3 | Expression Engine (full) — Temporal integration, local activity, input/output transforms | 1-2 | **COMPLETE** (24 tests, ~670 LOC) |
| 4 | External Call Tasks — call_http, call_grpc, call_llm, call_agent | 3-4 | **Next** |
| 5 | Advanced Tasks — try/catch, wait/listen, emit_event, notification, human_input, fork | 2-3 | Blocked on Phase 4 |
| 6 | Supporting Infrastructure — claimcheck, heartbeat, interceptors, OTel | 2-3 | Blocked on Phase 4 |
| 7 | Integration Testing — 12 golden YAMLs, regression suite | 3-4 | Blocked on Phase 5 |
| 8 | Deployment & Cutover — Docker, CI, gradual rollout | 2-3 | Blocked on Phase 7 |
| 9 | Cleanup — Delete Go workflow-runner, update CI | 1 | Blocked on Phase 8 |

## Key References

- **Go workflow-runner**: `backend/services/workflow-runner/` (~19K lines, 22 packages)
- **Zigflow engine core**: `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines)
- **Go for-task reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_for.go` (604 lines)
- **Go call:http reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_http.go`
- **Golden test YAMLs**: `backend/services/workflow-runner/test/golden/` (12 canonical workflows)
- **Runtime expressions**: `backend/services/workflow-runner/pkg/utils/runtime_expressions.go`
- **Unified runner project**: `_projects/2026-05/20260518.01.unified-runner-migration/`
- **PoC results**: `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/poc/results/`
- **TS workflow engine**: `backend/services/runner/src/workflow-engine/`
- **TS workflow function**: `backend/services/runner/src/workflows/execute-serverless-workflow.ts`

---

*This file provides direct paths to all project resources for quick context loading.*
