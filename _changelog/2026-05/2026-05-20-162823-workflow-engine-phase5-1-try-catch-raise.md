# Workflow Engine Phase 5.1: Try/Catch + Raise

**Date**: May 20, 2026

## Summary

Implemented try/catch error handling and raise task in the TypeScript workflow engine, exceeding Go reference parity with proper error capture (`catch.as`), error filtering (`catch.errors.with`), and conditional catch (`catch.when`). All sandbox-safe with zero Temporal imports and no changes to the kernel contract.

## Problem Statement

The TypeScript workflow engine had types and YAML parsing for try/catch and raise tasks, but no execution layer. Errors from task execution propagated uncaught through the entire workflow, making error recovery impossible. The Go reference implementation had a minimal try/catch (catch-all, no filtering, no error binding), but even its `catch.as` feature was broken at runtime.

### Pain Points

- Workflow authors had no way to handle errors gracefully within a workflow
- No mechanism to throw structured errors with specific types and status codes
- The Go implementation's `catch.as` was parsed but never wired, so `${ .error }` expressions in catch blocks silently failed
- No error filtering meant catch blocks couldn't distinguish validation errors from timeout errors

## Solution

Implemented a complete error handling subsystem with three new source files and wiring changes to three existing files, following the established patterns (`for` task's dedicated executor, lazy import for circular dependency, placeholder builder in task factory).

## Implementation Details

- **`WorkflowError` class** (`errors.ts`): Extends `Error` with CNCF error shape (`type`, `status`, `title`, `detail`, `instance`). Provides `toJSON()` for state serialization, `fromUnknown()` for universal error normalization, and `matches()` for filter evaluation.
- **`executeTryTask()`** (`tasks/try.ts`): Runs try block via `executeDoTasks()`, catches errors, normalizes via `fromUnknown()`, applies `catch.errors.with` filter, evaluates `catch.when` expression (with `$error` jq binding), binds error to `state.data[catch.as]`, runs `catch.do` block.
- **`RaiseTaskBuilder`** (`tasks/raise.ts`): Throws typed `WorkflowError` with jq expression evaluation in `title` and `detail` fields.
- **Loader hardening**: Replaced `raw.raise as any` with validated `parseRaiseConfig()` (type + status required at parse time). Typed `parseCatchConfig()` return.
- **Wiring**: `do-executor.ts` dispatches `TRY_TASK_KIND` alongside `do` and `for`. `task-factory.ts` registers `raise` + `try` (placeholder).

## Benefits

- Workflow authors can now handle errors gracefully with try/catch blocks
- Structured errors via `raise` enable fine-grained error categorization
- Error filtering lets catch blocks handle specific error types while re-throwing others
- Conditional catch via `when` expressions adds dynamic error handling logic
- `catch.as` binding actually works (unlike Go) — errors are available to jq expressions in catch blocks
- Zero impact on existing code: no `TaskExecutionContext` changes, no test mock updates

## Impact

- **42 new tests**, 1201 total passing, zero regressions
- **10 executable task types** (up from 8): `set`, `switch`, `do`, `for`, `try`, `raise`, `call:http`, `call:grpc`, `call:agent`, `call:function`
- **14 golden YAML workflows** (up from 13)
- TypeScript engine now exceeds Go parity on error handling — Go's try/catch is a catch-all with no filtering, no `as` binding, no `when` conditions

## Related Work

- Follows Phase 4b (`call:agent` async completion) — previous changelog: `2026-05-20-160315-workflow-engine-phase4b-call-agent.md`
- Catch-level retry deferred to Phase 5.1b (requires `sleep` callback on `TaskExecutionContext`)
- Next: Phase 5.2 (fork/parallel execution) or Phase 5.3 (wait/listen, emit_event, notification)

---

**Status**: Production Ready
**Timeline**: 1 session (~45 min implementation)
