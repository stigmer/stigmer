# Billing Runner + Workflow Integration (Phase 2.5+2.6)

**Date**: May 3, 2026

## Summary

Wired the prepaid billing system into the execution lifecycle across all three layers: the Temporal workflow (authorize/finalize), the Python agent-runner (per-LLM-call reporting), and the TypeScript cursor-runner (per-turn reporting). Executions are now gated on credit balance, debited in real-time, and finalized on all terminal paths.

## Problem Statement

The billing domain services (authorize, report, finalize) were implemented and unit-tested in Phase 2.2–2.4, but existed in isolation — no runner or workflow called them. Agent executions could run without any billing enforcement.

### Pain Points

- Executions consumed LLM resources without credit checks
- No mechanism to stop an execution when credits are exhausted
- The Cursor runner had no billing awareness at all
- No way to measure actual revenue per execution

## Solution

Three-layer integration following the existing polyglot architecture:

1. **Temporal Workflow** (Java) — Authorization gate before dispatch + finalization in detached finally scope
2. **Python Agent-Runner** — Per-LLM-call billing reporting after each `on_chat_model_end` event
3. **TypeScript Cursor-Runner** — Per-turn billing reporting after each `turn-ended` delta event

Both runners implement graceful stop when the billing service signals `stop_execution`:
- Python: `BillingStopMiddleware` blocks tools + injects summarize message
- Cursor: Breaks from streaming loop + returns billing-exhausted status

## Implementation Details

### Temporal Workflow (stigmer-cloud)

- Added `orgId` to `InvokeAgentExecutionWorkflowInput` (populated from `execution.metadata.org`)
- Created `BillingActivities` interface + `BillingActivitiesImpl` as local activities
- Authorization runs before the harness-dispatch branch — if denied, execution fails immediately
- Finalization runs in a detached cancellation scope (survives cancel/failure)
- Fail-safe: if billing service is unreachable, execution is denied (never unbilled)

### Python Agent-Runner (stigmer OSS)

- `BillingReporter` gRPC client: wraps `reportLlmCallUsage`, async-safe, graceful degradation
- `BillingStopMiddleware`: always-injected middleware that activates on STOP signal
- Integrated via `StatusBuilder._report_billing_usage()` — fires after every `on_chat_model_end`
- Global sequence counter across all scopes (main agent + sub-agents)
- Cost tier resolved from `ModelRegistry.get_or_default(model).cost_tier`

### TypeScript Cursor-Runner (stigmer OSS)

- `BillingClient`: Connect-RPC client for `BillingCommandController.reportLlmCallUsage`
- Added `costTier` field to `CursorModelPricing` interface (read from model-registry.json)
- Billing reporting in the streaming loop: after stamping metrics, reports to billing
- On STOP signal: `billingExhausted = true` → breaks from stream → returns completed with message

## Benefits

- **Revenue enforcement**: Every execution is now metered and billed
- **Credit protection**: Executions are denied when balance is too low to start
- **Graceful degradation**: Billing failures don't crash executions (reservation caps exposure)
- **Unified enforcement**: Both native (Python) and cursor (TypeScript) runners are covered
- **User transparency**: Clear messages when credits are exhausted

## Impact

- **All agent executions** are now subject to billing authorization
- **Both runner types** report per-call/per-turn usage to the billing service
- **Temporal workflow** handles the full lifecycle (reserve → execute → finalize)
- **Phase 2 is complete** — the execution enforcement MVP is feature-complete

## Related Work

- Phase 2.2: AuthorizeExecution handler + service (2026-05-03)
- Phase 2.3: ReportLlmCallUsage handler + service (2026-05-03)
- Phase 2.4: FinalizeExecution handler + service (2026-05-03)
- Next: Phase 3 — Stripe Checkout integration for credit purchases

---

**Status**: ✅ Production Ready (pending integration testing)
**Timeline**: Phase 2.5+2.6 completed in one session
