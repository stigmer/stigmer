# LLM Proxy Test Coverage: Full Cloud-Path Integration

**Date**: May 15, 2026

## Summary

Routed the cursor-runner through the Cursor proxy (mirroring the agent-runner's existing LLM proxy routing) and strengthened billing/usage test assertions to verify that proxy metering produces real data. Both integration test harnesses (native and cursor) now exercise the full cloud billing pipeline.

## Problem Statement

The integration tests had an asymmetry in LLM call routing: the native agent-runner was already routed through the LLM proxy (`/v1/proxy/llm/anthropic`), but the cursor-runner was calling Cursor's API directly with `CURSOR_API_KEY` — bypassing the proxy entirely. This meant cursor harness tests never produced `LlmCallUsageRecord` entries, billing debits were not written, and usage reports returned zeroes for cursor executions.

Additionally, the billing and usage test assertions used soft checks (`GreaterOrEqual(0)`) that would pass even when the proxy was misconfigured and no metering data existed.

### Pain Points

- Cursor harness test path did not match production (cloud routes through `CursorProxyController`)
- Billing tests could silently pass with zero metering data
- No helper existed to verify that a specific execution was proxy-metered

## Solution

Brought the cursor-runner through the Cursor proxy using the same environment-driven pattern as the agent-runner, then tightened all billing and usage assertions to require non-zero proxy-derived data.

## Implementation Details

### Cursor-Runner Proxy Routing

- Added `CursorAPIKey` to `ServiceConfig` — passes `STIGMER_PROXY_CURSOR_API_KEY` to the Java service so `CursorProxyController` has a key to forward to Cursor's API
- Added `ProxyEndpoint` to `CursorRunnerConfig` — when set, `buildCursorRunnerEnv` passes `STIGMER_PROXY_ENDPOINT` and `STIGMER_TOKEN` instead of `CURSOR_API_KEY`
- The cursor-runner's `fetch-interceptor.ts` activates on `STIGMER_PROXY_ENDPOINT`, rewriting Cursor SDK HTTP calls to `{proxy}/v1/proxy/cursor/{host}/...`
- Added `STIGMER_PROXY_REQUIRE_SCOPE_HEADER=false` to the Java service env — prevents 403s during runner metadata calls that lack execution scope headers

### Strengthened Assertions

- `CreditDebit`: `LessOrEqual` → strict `Less` (credits must decrease)
- `LedgerAuditTrail`: added `usageDebitCount > 0` assertion (proxy metering signature)
- `ExecutionReport`: `GreaterOrEqual(0)` → `Greater(0)` for input/output tokens, call count, billable cost
- `SessionReport`: requires non-nil `total_usage` with non-zero tokens and billable cost
- `OrgReport`: requires non-zero `total_billable_cost_micros`

### Proxy Verification Helper

- Created `AssertProxyMetered` in `harness/billing_helpers.go` — queries the credit ledger for `usage_debit` entries scoped to a specific execution ID

## Benefits

- Both test harnesses now exercise the full cloud billing pipeline end-to-end
- Proxy misconfiguration is caught immediately by failing assertions (no more silent zero-data passes)
- Any test can use `AssertProxyMetered(t, ctx, clients, executionID)` as a one-liner guard

## Impact

- **Integration tests**: 5 modified files, 1 new file — all under `test/integration/`
- **Test confidence**: Billing and usage tests now serve as regression guards for proxy routing
- **Cloud parity**: Both harnesses match production routing topology

## Related Work

- Agent-runner proxy routing (Session 17 — `STIGMER_PROXY_ENDPOINT` + `STIGMER_PROXY_ANTHROPIC_API_KEY`)
- Side-Channel Proxy Phase 0 (April 2026 — `LlmProxyController`, `CursorProxyController`)
- Billing metering pipeline (`ProxyUsageReporter` → `RecordLlmCallUsageHandler` → `LlmCallUsageRecord`)

---

**Status**: ✅ Production Ready
