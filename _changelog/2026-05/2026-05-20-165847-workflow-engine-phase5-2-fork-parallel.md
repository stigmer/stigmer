# Workflow Engine Phase 5.2: Fork (Parallel Execution)

**Date**: May 20, 2026

## Summary

Implemented the fork task for the TypeScript workflow engine, enabling parallel execution of branches within CNCF Serverless Workflow definitions. Supports both non-compete (all branches run, results collected by name) and compete/race (first branch to complete wins) modes, matching Go's semantics while improving on its type safety and spec alignment.

## Problem Statement

The TypeScript workflow engine could execute tasks sequentially (do, for) and handle errors (try/catch), but had no parallel execution capability. The fork task type was parsed by the loader and typed in the type system, but had no executor — hitting a fork task threw "Unsupported task type."

### Pain Points

- No parallel branch execution in the TypeScript engine
- Golden YAMLs #04 and #10 (parallel workflows) could not run
- Workflows requiring concurrent HTTP calls, LLM calls, or agent calls had to execute sequentially
- Go workflow runner was the only engine capable of parallel execution

## Solution

Added `executeForkTask()` following the established orchestration task pattern (same as `for` and `try`): dedicated executor function dispatched from `runSingleTask()`, with a placeholder builder in the task factory. Two execution modes:

- **Non-compete** (default): `Promise.all` runs all branches in parallel, output is `{ branchName: branchOutput }`
- **Compete** (race): `Promise.race` returns the first branch to complete, losing branches finish in background

## Implementation Details

- **`tasks/fork.ts`** (~190 lines) — Core executor with branch normalization (unwraps DoTaskDef branches, wraps single leaf tasks), state isolation via `clone() + clearOutput()` per branch, and `ForkTaskPlaceholderBuilder`
- **`do-executor.ts`** — `FORK_TASK_KIND` dispatch in `runSingleTask()`, identical pattern to `FOR_TASK_KIND` and `TRY_TASK_KIND`
- **`task-factory.ts`** — Fork case in the switch statement, `FORK_TASK_KIND` export
- **Golden YAML #15** — Non-compete 3-branch fork, downstream aggregation via `$output`, compete mode, nested fork (fork inside fork)

### Key Design Decisions

1. **No active cancellation in compete mode** — Preserves kernel Temporal-agnosticism. Go's `workflow.WithCancel` also doesn't short-circuit in practice. Losing branches run to completion but results are discarded.
2. **Winner's raw output for compete mode** — Go's `maps.Copy(result.data.(map[string]any))` panics on non-map outputs. Our implementation returns the winner's output as-is, matching CNCF spec: "returns only the output of the winning branch."
3. **Fail-fast error semantics** — `Promise.all` for non-compete, `Promise.race` for compete. Composes correctly with try/catch.
4. **No TaskExecutionContext changes** — Zero kernel contract changes, zero test mock updates. Clean, additive.

## Benefits

- Parallel workflow execution now possible in the TypeScript engine
- 37 new tests covering both modes, state isolation, error handling, nested orchestration
- 1,238 total tests passing with zero regressions
- Golden YAML #15 provides comprehensive fork coverage for integration testing
- Improves on Go's implementation: type-safe compete output, no panic risk on non-map results

## Impact

- **Workflow Engine**: 11 of 14 CNCF task types now executable (remaining: wait, listen, run)
- **Platform Builders**: Workflows with parallel branches can now run on the TypeScript runner
- **Migration**: One more step toward eliminating Go from the runner execution tier

## Related Work

- Phase 5.1: Try/Catch + Raise (`2026-05-20-162823-workflow-engine-phase5-1-try-catch-raise.md`)
- Phase 4b: Call Agent (`2026-05-20-160315-workflow-engine-phase4b-call-agent.md`)
- Phase 4: External Call Tasks (`2026-05-20-152044-workflow-engine-phase4-external-call-tasks.md`)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (executor + wiring + 37 tests + golden YAML + documentation)
