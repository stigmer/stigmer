# Session Notes: 2026-05-20 Session 4 — Phase 3 Temporal Integration

## Accomplishments

- Created `EvaluateExpressions` local activity (factory pattern, wraps `evaluateExpressionBatch`)
- Created `executeServerlessWorkflow` Temporal workflow (`"stigmer/workflow/execute"`)
- Implemented task-level `input.from` resolution in `do-executor.ts`
- Implemented workflow-level `input.from` and `output.as` in the workflow function
- Registered workflow and activity on the existing Temporal worker
- Confirmed kernel was already sandbox-safe (no refactoring needed)
- 24 new tests (8 activity + 11 workflow + 5 input.from), all 1045 passing

## Decisions Made

- **Local activity IS the determinism boundary** — no separate sideEffect needed. All expression results (including uuid) are recorded in workflow history on first execution and replayed deterministically.
- **Workflow type name**: `"stigmer/workflow/execute"` — single generic workflow, not per-definition dynamic registration.
- **Kernel was already sandbox-safe** — Phase 2's for-task correctly used the injected evaluator. The plan's Step 1 (decouple for.ts) turned out to be a no-op.
- **Set task ignores task input** — set tasks evaluate with `null` as jq input and access data through state variables. `input.from` is primarily relevant for future call tasks (Phase 4).

## Key Code Changes

- `activities/evaluate-expressions.ts`: Thin factory wrapping `evaluateExpressionBatch`
- `workflows/execute-serverless-workflow.ts`: Full workflow with proxyLocalActivities, input/output transforms
- `do-executor.ts`: Added `resolveTaskInput()` function (35 lines)
- `workflows/index.ts`: Added `"stigmer/workflow/execute"` export
- `main.ts`: Added `createEvaluateExpressionsActivities()` registration

## Learnings

- The Temporal TS SDK uses `proxyLocalActivities` for same-process activities with history recording — perfect for jq-wasm which has ~1ms overhead per call
- The kernel module graph (do-executor → tasks → types/state) has zero Node.js transitive deps — only `expression.ts` touches `node:crypto` and `jq-wasm`
- Vitest mock pattern for Temporal workflows: mock `@temporalio/workflow` module, provide fake `proxyLocalActivities` that delegates to real jq for integration testing
- `vi.fn()` generic syntax changed in Vitest 3.x — use untyped `vi.fn()` and cast at call sites

## Open Questions

- Should set tasks use their effective input (from `input.from`) as the jq `.` input instead of `null`? Current behavior matches Go but may not match CNCF spec intent.
- Will the Temporal workflow bundler handle the kernel imports correctly in production? Validated with `tsc --noEmit` but not with actual Temporal bundling.

## Next Session Plan

- Phase 4: External Call Tasks (call:http, call:grpc, call:llm, call:agent)
- These are Temporal activities that receive resolved inputs (from `input.from` + expression evaluation)
- Start with call:http since it has the most test coverage in Go golden YAMLs
