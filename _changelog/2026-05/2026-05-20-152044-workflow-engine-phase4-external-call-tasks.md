# Workflow Engine Phase 4: External Call Tasks

**Date**: May 20, 2026

## Summary

Implemented the three synchronous external call task types (`call:http`, `call:grpc`, `call:llm`) as Temporal activities integrated into the TypeScript workflow engine. Extended the sandbox-safe kernel architecture with a callback-based pattern that lets call task builders invoke network I/O without importing Temporal APIs directly. 77 new tests, zero regressions against the existing 1058.

## Problem Statement

The TypeScript workflow engine (Phases 1-3) could only execute pure-logic tasks (`set`, `switch`, `do`, `for`). All 11 golden YAML workflows that use `call: http` would fail at runtime with "Unsupported task type." The engine needed external call capabilities to reach feature parity with the Go workflow-runner.

### Pain Points

- Workflows could not make HTTP requests, gRPC calls, or LLM API calls
- The sandbox-safe kernel had no mechanism for delegating network I/O to Temporal activities
- Expression evaluation utilities were duplicated in `set.ts` with no shared module for reuse
- No infrastructure for the two-phase expression evaluation security pattern (workflow-side jq, activity-side secrets)

## Solution

Extended the `TaskExecutionContext` interface with strongly-typed call callbacks (`callHttp`, `callGrpc`, `callFunction`) that the workflow function wires to `proxyActivities`. The kernel invokes these as opaque callbacks — it never imports Temporal APIs. Extracted shared expression resolution and runtime placeholder utilities into `resolve.ts`. Implemented three Temporal activities for the actual I/O.

## Implementation Details

### Architecture: Callback Injection Pattern

```
Workflow Function (Temporal sandbox)
  └─ proxyActivities<CallActivities>() → creates activity proxies
  └─ builds TaskExecutionContext with call callbacks wired to proxies
  └─ executeDoTasks(tasks, input, state, doc, evalExprs, ctx)
       └─ CallHttpTaskBuilder.build()
            └─ resolveConfigExpressions(with, ...) → evaluates ${ ... } via local activity
            └─ ctx.callHttp(evaluatedConfig, state.env) → schedules regular activity
                 └─ Activity: resolves ${.secrets.*}, executes fetch(), classifies errors
```

### Files Created (16 new)

| File | Purpose |
|------|---------|
| `workflow-engine/resolve.ts` | Shared expression collection, substitution, runtime placeholder resolution |
| `workflow-engine/tasks/call-http.ts` | CallHTTP task builder |
| `workflow-engine/tasks/call-grpc.ts` | CallGRPC task builder |
| `workflow-engine/tasks/call-function.ts` | CallFunction task builder (dispatches llm, agent, etc.) |
| `activities/call-http.ts` | HTTP activity — fetch, error classification, 3 output modes |
| `activities/call-grpc.ts` | gRPC activity — dynamic proto loading via @grpc/proto-loader |
| `activities/call-llm.ts` | LLM activity — OpenAI + Anthropic, proxy + direct modes |
| `activities/call-function.ts` | Function dispatcher — routes to llm/agent by call string |
| 8 test files | 77 tests covering builders, activities, utilities |

### Files Modified (11)

- `workflow-engine/types.ts` — Extended `TaskExecutionContext` with `CallHttpFn`, `CallGrpcFn`, `CallFunctionFn`
- `workflow-engine/task-factory.ts` — Added `call:http`, `call:grpc`, `call:function` dispatch
- `workflow-engine/do-executor.ts` — Accepts full `TaskExecutionContext`, propagates through recursion with backward-compatible fallback
- `workflow-engine/tasks/set.ts` — Refactored to import shared utilities from `resolve.ts`
- `workflow-engine/tasks/for.ts` — Propagates `TaskExecutionContext` through iterations
- `workflows/execute-serverless-workflow.ts` — Added `proxyActivities` for call tasks, builds full context
- `main.ts` — Registered 3 new activity factories
- 4 test files updated for `TaskExecutionContext` compatibility

### Key Design Decisions

- **Per-type callbacks** (not a generic dispatcher) — type safety at the kernel contract boundary, each call type has distinct input/output shapes
- **Two-phase expression evaluation** — workflow resolves `${ $context.field }` jq expressions, activities resolve `${.secrets.KEY}` runtime placeholders (secrets never in Temporal history)
- **`buildMinimalContext` fallback** — backward compatibility for existing tests and `for.ts` callers without full context; call callbacks throw descriptively if invoked
- **Raw fetch for LLM** — used native `fetch()` instead of LangChain wrappers for simple prompt-response; lighter, fewer abstractions for this use case
- **`call:agent` deferred** — placeholder throws `ApplicationFailure.nonRetryable` with clear message; requires separate planning for async completion + HITL signals

### Error Classification (call:http)

| HTTP Status | Temporal Behavior |
|-------------|-------------------|
| 2xx | Success |
| 3xx | Non-retryable (`HTTP_REDIRECT`) |
| 4xx | Non-retryable (`HTTP_CLIENT_ERROR`) |
| 5xx | Retryable (Temporal default: 5 attempts, exponential backoff) |
| Network error | Retryable |

## Benefits

- 11 of 12 golden YAML workflows can now execute their `call: http` tasks through the TypeScript engine
- LLM workflow tasks support both proxy mode (cloud) and direct API key mode (OSS)
- gRPC workflow tasks support dynamic proto loading without pre-compiled stubs
- Expression evaluation utilities are shared across all task types, eliminating duplication
- Runtime placeholder resolution (secrets, env vars) is centralized and testable

## Impact

- **Workflow Runner rewrite**: Phases 1-4 are now complete (4.5 `call:agent` deferred to dedicated session)
- **Golden YAML coverage**: Engine can now parse and execute 7 of the 12 task types (`set`, `switch`, `do`, `for`, `call:http`, `call:grpc`, `call:function`)
- **Test suite**: 1135 total tests (from 1058), zero regressions

## Related Work

- Phase 1 scaffold: `2026-05-20-131102-workflow-engine-phase1-scaffold.md`
- Phase 2 for-task: `2026-05-20-133907-workflow-engine-phase2-for-task.md`
- Phase 3 Temporal integration: `2026-05-20-141917-workflow-engine-phase3-temporal-integration.md`
- Go reference: `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_call_*.go`

---

**Status**: Production Ready
**Timeline**: Session 5 of the workflow-runner TypeScript rewrite project
