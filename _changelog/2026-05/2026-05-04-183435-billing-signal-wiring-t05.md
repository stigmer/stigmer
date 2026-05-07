# Wire Billing Signal into updateStatus Response (T05)

**Date**: May 4, 2026

## Summary

Connected the billing enforcement loop to the runner by wiring live billing signals into the `updateStatus` RPC response. The runner now receives STOP, WARNING, or CONTINUE on every heartbeat (~2-3 seconds), enabling real-time credit enforcement during execution. This completes the billing signal delivery path that was designed in the proxy-metering architecture but left as a TODO.

## Problem Statement

The proxy-side billing pipeline (T01-T04) debits credits on each LLM call, and `ExecutionBillingService.reportLlmCallUsage()` computes an `ExecutionBillingSignal` after each debit. But that signal was discarded — the proxy can't act on it because the LLM stream has already been relayed to the runner. The `updateStatus` RPC was the designed delivery channel, but `BuildUpdateStatusResponseStep` always returned `UNSPECIFIED`.

### Pain Points

- Runner had no way to know when credits were exhausted
- Low-balance warnings never reached the runner
- The billing pipeline computed signals that were thrown away
- `BuildUpdateStatusResponseStep` had a TODO comment since T02

## Solution

Added a read-only billing signal query (`ExecutionBillingService.querySignal()`) that checks the current reservation and account state without performing any writes. Wired it into the `updateStatus` pipeline through a bounded-context mapper (`BillingSignalMapper`) that translates billing-domain signals to the agentic-domain control signal vocabulary.

## Implementation Details

### ExecutionBillingService.querySignal(executionId)

Read-only method that determines the billing signal for an in-flight execution:

1. Look up `ExecutionReservation` by execution ID
2. If no reservation exists (OSS mode, billing not configured): return `continue_execution` — non-billed executions are never interrupted
3. Load billing account via org ID from reservation
4. If account not found or not active: return `stop_execution`
5. Compute remaining reservation headroom (`reserved - consumed`)
6. Delegate to `CreditLedgerService.determineSignal(account, headroom)` for the threshold-based decision

Returns a `BillingSignalResult` Java record (signal + human-readable reason).

### BillingSignalMapper

Static mapper bridging two bounded contexts:

- `stop_execution` → `EXECUTION_CONTROL_SIGNAL_STOP`
- `low_balance_warning` → `EXECUTION_CONTROL_SIGNAL_WARNING`
- `continue_execution` / `unspecified` → `EXECUTION_CONTROL_SIGNAL_UNSPECIFIED`

### BuildUpdateStatusResponseStep

Replaced the TODO with the full wiring:

- Injects `ExecutionBillingService`
- Calls `querySignal(executionId)` inside a try-catch
- Maps billing signal → execution control signal via `BillingSignalMapper`
- Logs STOP/WARNING signals at INFO level for observability
- On any exception: logs warning, returns UNSPECIFIED (billing check failure never breaks status updates)

### Design Decision: Don't Strip llm_metrics

The original plan included stripping runner-reported `llm_metrics` from `AgentMessage` in cloud mode. After analysis, this was deferred:

- The billing trust boundary is already enforced at the collection level (`LlmCallUsageRecord` is the billing authority)
- No billing code reads `llm_metrics`
- Stripping would break `UsageAggregationService` (used by three usage report RPCs)
- Migrating those reports to `LlmCallUsageRecord`-based queries is tracked as a follow-up in the parent project

## Benefits

- Runners receive real-time billing enforcement signals on every heartbeat
- Credit-exhausted executions stop gracefully instead of running indefinitely
- Low-balance warnings give the runner (and user) advance notice
- OSS mode and non-billed executions are unaffected (continue by default)
- Billing service failures never break the execution loop

## Impact

- **Runner**: Now receives actionable signals; `BillingStopMiddleware` (already deployed) can react to STOP/WARNING
- **Billing pipeline**: Signal path is complete — authorize → proxy debit → signal query → runner enforcement → finalize
- **Observability**: STOP and WARNING signals are logged at INFO level for ops visibility

## Files Changed

### stigmer-cloud (7 files, +554 -15)

| File | Change |
|------|--------|
| `ExecutionBillingService.java` | Added `querySignal()` + `BillingSignalResult` record |
| `BillingSignalMapper.java` | New: static bounded-context signal mapper |
| `AgentExecutionUpdateStatusHandler.java` | Rewired `BuildUpdateStatusResponseStep` from TODO to live billing |
| `BUILD.bazel` | 3 new test targets |
| `ExecutionBillingServiceQuerySignalTest.java` | New: 6 scenario tests |
| `BillingSignalMapperTest.java` | New: 4 enum mapping tests |
| `BuildUpdateStatusResponseStepTest.java` | New: 5 tests (including graceful degradation) |

### stigmer (3 files, +121 -9)

| File | Change |
|------|--------|
| Sub-project `next-task.md` | T05 completion status, updated context |
| Parent `next-task.md` | Follow-up work items (UsageAggregationService migration, legacy proto cleanup) |
| Session checkpoint | `checkpoints/2026-05-04-session-5.md` |

## Related Work

- T01-T04: SSE usage parser, layered usage model, proxy controller wiring (prerequisite)
- Parent billing integration: Phase 2.3 `reportLlmCallUsage` (produces the signals)
- Parent billing integration: Phase 2.5 `BillingStopMiddleware` (consumes the signals in runner)
- Follow-up: Migrate `UsageAggregationService` to `LlmCallUsageRecord` (tracked in parent)
- Follow-up: Remove legacy `UsageMetrics`/`ModelUsage`/`LlmCallMetrics` proto types (tracked in parent)

---

**Status**: ✅ Production Ready
**Commits**: `b5670cc4d` (stigmer), `cf71e0fd` (stigmer-cloud)
