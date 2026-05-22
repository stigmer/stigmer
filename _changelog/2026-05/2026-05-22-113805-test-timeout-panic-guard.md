# Test Timeout Panic Guard — Deadline-Aware Context for Integration Tests

**Date**: May 22, 2026

## Summary

Added a `harness.TestContext()` helper that clamps per-test timeouts against the Go test binary's global deadline, preventing any single test from panicking the entire binary and killing unrelated tests. Also made all waiter poll loops instantly responsive to context cancellation during sleep intervals.

## Problem Statement

`TestAgentExecution_Recover/native` exhausted the global `-timeout 900s` and caused Go to panic the entire test binary. This killed all `TestWorkflow*` tests that were queued to run after it, and caused gotestsum to abort with "suspected panic and some test may not have run".

### Pain Points

- Every agent execution test created `context.WithTimeout(context.Background(), 5*time.Minute)` — completely oblivious to the Go test binary's global deadline
- When upstream failures (FGA auth issues) caused waiter loops to burn their full timeouts, cumulative test time exceeded 15 minutes
- Go panicked the binary, killing all subsequent tests — 0% visibility into `TestWorkflow*` results
- gotestsum refused to rerun any tests after detecting the panic
- Waiter poll loops used `time.Sleep(interval)` which was unresponsive to context cancellation for up to 2 seconds per iteration

## Solution

Introduced a centralized `harness.TestContext(t, perTestTimeout)` function that reads `t.Deadline()` (Go 1.15+) and clamps the per-test timeout to fit within the global deadline minus a 30-second safety buffer. If no time remains, the test is skipped gracefully instead of contributing to a binary panic.

## Implementation Details

### New file: `test/integration/harness/context.go`

- `TestContext(t, perTestTimeout)` — returns `(context.Context, context.CancelFunc)`
- Uses `t.Deadline()` to read the `-timeout` flag's effective deadline
- Reserves 30 seconds for cleanup and gotestsum bookkeeping
- Clamps `perTestTimeout` to `min(perTestTimeout, remaining - 30s)`
- Skips (not fails) if insufficient time remains

### Updated: 14 agent execution test files

Replaced all 65 `context.WithTimeout(context.Background(), ...)` calls with `harness.TestContext(t, ...)` across:

- `agent_execution_01_lifecycle_test.go` through `agent_execution_14_streaming_test.go`

Removed the now-unused `"context"` import from 10 files that no longer reference the `context` package directly.

### Updated: `harness/agent_execution_waiter.go`

Replaced `time.Sleep(interval)` with context-aware select blocks in `WaitForPhase`, `WaitForTerminal`, and `ResolveApprovalsUntilPhase`:

```go
select {
case <-ctx.Done():
    return nil, ctx.Err()
case <-time.After(interval):
}
```

Removed the redundant top-of-loop `select { case <-ctx.Done(): ... default: }` blocks since the sleep-select now serves that purpose.

### Updated: `harness/assertions.go`

Applied the same context-aware sleep pattern to the workflow `ExecutionWaiter` methods: `WaitForPhase`, `WaitForTerminal`, and `WaitForTaskWaitingApproval`.

## Benefits

- **No test can panic the binary**: The global deadline is always respected with a safety margin
- **TestWorkflow* tests will run**: Even if agent execution tests exhaust their budgets, they fail gracefully
- **gotestsum can rerun**: Clean timeout errors instead of panics means reruns work normally
- **Instant context response**: Waiters respond to cancellation within the current poll interval, not after a full sleep cycle
- **Zero behavioral change for passing tests**: When the global deadline is far away, `TestContext` returns the original timeout unchanged

## Impact

- **Test infrastructure**: All 14 agent execution test files + 2 harness waiter files
- **CI reliability**: Eliminates the class of "binary panic kills entire suite" failures
- **Developer experience**: Tests that run out of global budget skip with a clear message instead of crashing

## Related Work

- Integration Test Session 9 Report (`_cursor/integration-test-session9-report.md`) — identified this as Category 5 / P1
- Category 1 (FGA auth) is the upstream root cause; this fix ensures Category 1 failures degrade gracefully

---

**Status**: Production Ready
**Timeline**: ~30 minutes
