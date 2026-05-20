# Next Task: 20260519.01.workflow-runner-typescript-rewrite

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260519.01.workflow-runner-typescript-rewrite

**Description**: Rewrite the Go-based workflow-runner (Zigflow/CNCF Serverless Workflow engine) in TypeScript and merge it into the unified TypeScript runner, eliminating Go from the runner execution tier entirely.
**Goal**: Single TypeScript runner service that handles all three execution types: ExecuteDeepAgent, ExecuteCursor, and ExecuteServerlessWorkflow. Go workflow-runner deleted after validated cutover. All 12 golden YAML workflows passing identically in TypeScript.
**Tech Stack**: TypeScript/Node.js, Temporal TypeScript SDK, jq-wasm (expression evaluation), js-yaml, semver, @grpc/proto-loader, @grpc/grpc-js, Ajv (JSON Schema), openai/anthropic SDKs, @aws-sdk/client-s3, @opentelemetry/api, Vitest

## Current Status

**Created**: 2026-05-19
**Current Task**: Phase 4b — call:agent (async completion + HITL)
**Status**: NOT STARTED
**Last Session**: 2026-05-20, Session 5

## Session Progress (2026-05-20, Session 5)

### Accomplishments — Phase 4: External Call Tasks (4.1–4.4)
- **4.1 Shared Infrastructure**: Extended `TaskExecutionContext` with call callbacks (`callHttp`, `callGrpc`, `callFunction`), extracted expression resolution utilities into `resolve.ts`, wired `proxyActivities` in workflow function, updated task-factory dispatch
- **4.2 call:http**: Activity with fetch, error classification (4xx non-retryable, 5xx retryable), 3 output modes (content/response/raw), runtime placeholder resolution. Builder with expression evaluation in URI/headers/body/query. 21 tests.
- **4.3 call:grpc**: Activity with dynamic proto loading via `@grpc/proto-loader` + `@grpc/grpc-js`. Builder with expression evaluation in service/method/arguments. 7 tests.
- **4.4 call:llm**: Activity with OpenAI + Anthropic support, proxy mode + direct mode, response schema handling, token counting. CallFunction dispatcher routes by call string. 25 tests.
- **Backward compatibility**: `buildMinimalContext` fallback for existing callers; `for.ts` and nested `do` propagate full context. 4 existing test files updated.
- **77 new tests**, 1135 total tests passing, zero regressions

### Key Decisions
- **Per-type callbacks on TaskExecutionContext** — not a generic dispatcher. Type safety at the kernel boundary, each call type has a distinct input/output shape.
- **Two-phase expression evaluation** — workflow evaluates `${ ... }` jq expressions (deterministic, in history), activities resolve `${.secrets.*}` runtime placeholders (never in history). Security pattern from Go.
- **Raw fetch for LLM** — used native `fetch()` instead of LangChain wrappers. Lighter for simple prompt-response.
- **call:agent deferred to Phase 4b** — placeholder throws `ApplicationFailure.nonRetryable` with clear message. Needs dedicated planning for async completion, HITL signal handling, and platform gRPC integration.

### Key Findings
- `@grpc/proto-loader` and `@grpc/grpc-js` were already installed as transitive deps — no new package additions needed
- The `collectExpressions`/`substituteResults` pattern from `set.ts` generalized cleanly to all call types via `resolveConfigExpressions`
- `buildMinimalContext` with throwing stubs provides clean backward compatibility — existing tests that don't exercise call tasks work unchanged

### Files Created
- **Created**: `backend/services/runner/src/workflow-engine/resolve.ts` (~170 lines)
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-http.ts`
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-grpc.ts`
- **Created**: `backend/services/runner/src/workflow-engine/tasks/call-function.ts`
- **Created**: `backend/services/runner/src/activities/call-http.ts` (~155 lines)
- **Created**: `backend/services/runner/src/activities/call-grpc.ts` (~120 lines)
- **Created**: `backend/services/runner/src/activities/call-llm.ts` (~210 lines)
- **Created**: `backend/services/runner/src/activities/call-function.ts` (~55 lines)
- **Created**: 8 test files (77 tests total)

### Files Modified
- **Modified**: `backend/services/runner/src/workflow-engine/types.ts` (+47 lines — call callbacks, metadata types)
- **Modified**: `backend/services/runner/src/workflow-engine/task-factory.ts` (+17 lines — 3 new cases)
- **Modified**: `backend/services/runner/src/workflow-engine/do-executor.ts` (+53 lines — full ctx propagation)
- **Modified**: `backend/services/runner/src/workflow-engine/tasks/set.ts` (-94 lines, +2 — uses resolve.ts)
- **Modified**: `backend/services/runner/src/workflow-engine/tasks/for.ts` (+3 lines — ctx param)
- **Modified**: `backend/services/runner/src/workflows/execute-serverless-workflow.ts` (+60 lines — proxyActivities)
- **Modified**: `backend/services/runner/src/main.ts` (+9 lines — 3 activity registrations)
- **Modified**: 4 test files (updated for TaskExecutionContext compatibility)

### Test Results
- 77 new tests (22 resolve + 5 call-http builder + 4 call-grpc builder + 5 call-function builder + 16 call-http activity + 3 call-grpc activity + 19 call-llm activity + 4 call-function activity)
- 1135 total tests passing across the entire runner
- `tsc --noEmit` clean
- Zero regressions

## Next Steps

1. **Phase 4b: call:agent** — async completion pattern, HITL signal handling, platform gRPC integration (dedicated planning session)
2. **Phase 5: Advanced Tasks** — try/catch, wait/listen, emit_event, notification, human_input, fork (parallel)
3. **Phase 6: Supporting Infrastructure** — claimcheck, heartbeat, interceptors, OTel, event emission, budget tracking
4. **Phase 7: Integration Testing** — 12 golden YAMLs passing identically, regression suite

## Context for Resume

- The workflow engine at `src/workflow-engine/` is a sandbox-safe execution kernel with zero Node.js dependencies
- Expression evaluation runs in a local activity (`activities/evaluate-expressions.ts`) — the kernel calls it via the injected `ExpressionEvaluator` callback
- **New in Phase 4**: External call tasks use regular Temporal activities via `proxyActivities`. The kernel calls `ctx.callHttp(config, env)` etc. — opaque callbacks wired to activity proxies by the workflow function.
- The `resolve.ts` module provides shared utilities: `resolveConfigExpressions` (workflow-side jq evaluation), `resolveObjectPlaceholders` (activity-side secret resolution), `collectExpressions`, `substituteResults`
- `call:function` is the dispatch point for Stigmer extensions (llm, agent, etc.) — `CallFunctionTaskBuilder` passes the `call` string through to the activity which routes internally
- `call:agent` is not yet implemented — throws `ApplicationFailure.nonRetryable` with "Phase 4b" message. Requires async completion + HITL signals.
- The Temporal workflow `"stigmer/workflow/execute"` lives at `workflows/execute-serverless-workflow.ts`
- `executeDoTasks()` now accepts an optional `TaskExecutionContext` parameter; when omitted, `buildMinimalContext()` creates a fallback with throwing stubs for call callbacks
- The Go reference implementation is at `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines, 22 packages)
- Golden test YAMLs are at `backend/services/workflow-runner/test/golden/` (12 canonical workflows)
- Executable task types: `set`, `switch`, `do`, `for`, `call:http`, `call:grpc`, `call:function`. All others parse but throw at runtime.

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
| 4 | External Call Tasks — call_http, call_grpc, call_llm, call_agent | 3-4 | **4.1–4.4 COMPLETE** (77 tests, ~1,600 LOC). 4.5 call:agent deferred. |
| 5 | Advanced Tasks — try/catch, wait/listen, emit_event, notification, human_input, fork | 2-3 | Blocked on Phase 4b |
| 6 | Supporting Infrastructure — claimcheck, heartbeat, interceptors, OTel | 2-3 | Blocked on Phase 4b |
| 7 | Integration Testing — 12 golden YAMLs, regression suite | 3-4 | Blocked on Phase 5 |
| 8 | Deployment & Cutover — Docker, CI, gradual rollout | 2-3 | Blocked on Phase 7 |
| 9 | Cleanup — Delete Go workflow-runner, update CI | 1 | Blocked on Phase 8 |

## Key References

- **Go workflow-runner**: `backend/services/workflow-runner/` (~19K lines, 22 packages)
- **Zigflow engine core**: `backend/services/workflow-runner/pkg/zigflow/` (~12.7K lines)
- **Go for-task reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_for.go` (604 lines)
- **Go call:http reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_http.go`
- **Go call:grpc reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_grpc.go`
- **Go call:llm reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_llm.go`
- **Go call:agent reference**: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_agent.go` (~1,500 lines)
- **Golden test YAMLs**: `backend/services/workflow-runner/test/golden/` (12 canonical workflows)
- **Runtime expressions**: `backend/services/workflow-runner/pkg/utils/runtime_expressions.go`
- **Unified runner project**: `_projects/2026-05/20260518.01.unified-runner-migration/`
- **PoC results**: `_projects/2026-05/20260519.01.workflow-runner-typescript-rewrite/poc/results/`
- **TS workflow engine**: `backend/services/runner/src/workflow-engine/`
- **TS workflow function**: `backend/services/runner/src/workflows/execute-serverless-workflow.ts`
- **TS resolve utilities**: `backend/services/runner/src/workflow-engine/resolve.ts`
- **TS call activities**: `backend/services/runner/src/activities/call-http.ts`, `call-grpc.ts`, `call-llm.ts`, `call-function.ts`

---

*This file provides direct paths to all project resources for quick context loading.*
