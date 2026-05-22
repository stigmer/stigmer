# Phase 6 Remaining Items Complete — Notification, Event Delivery, Budget Tracking, Listen Query/Update

**Date**: May 20, 2026

## Summary

Completed all four remaining Phase 6 items for the TypeScript workflow runner: listen query/update event types, notification task with provider registry, event emission delivery with webhook and signal targets, and budget tracking with OTel LLM metrics parity. Phase 6 is now fully complete with 91 new tests across all items.

## Problem Statement

Phase 6 (Supporting Infrastructure) was partially complete with claimcheck, OTel workflow instrumentation, activity heartbeating, and baggage propagation done. Four items remained:

### Pain Points

- Listen task only supported signals; query and update event types were rejected with an error despite Go having full implementation
- No notification capability existed in the TS runner — Go had a provider registry with webhook support
- Event emission only built CloudEvents envelopes but had no delivery mechanism to external consumers or other workflows
- OTel LLM metrics were incomplete (5 of 9 instruments vs Go parity), and no budget tracking concept existed despite Go having a full `budget.Tracker` package

## Solution

Implemented all four items in order of design certainty, each as a self-contained unit with comprehensive tests, preserving kernel purity (zero Temporal imports in `src/workflow-engine/`).

## Implementation Details

### 1. Listen Query/Update Event Types (22 tests)
- Expanded `SUPPORTED_EVENT_TYPES` from `["signal"]` to `["signal", "query", "update"]`
- Rewrote listen orchestrator to route by event type: `defineQuery` (non-blocking, read-only), `defineUpdate` (blocking, bidirectional with validator), `defineSignal` (existing)
- Added `data` field to `ListenEventDef` for query/update reply templates

### 2. Notification Task (23 tests)
- New `src/notification/` module: `NotificationProvider` interface, thread-safe registry, `WebhookProvider` (HTTP POST with 30s timeout, non-fatal delivery)
- `notificationAction()` activity with JIT placeholder resolution in body/subject/recipients/metadata
- Wired into call-function dispatcher as `case "notification"`

### 3. Event Emission Delivery (17 tests)
- Extended `emitEventAction` with optional `delivery` targets (webhook + signal)
- Webhook: HTTP POST with `application/cloudevents+json` content type, header placeholder resolution
- Signal: Temporal `WorkflowClient.signal()` for cross-workflow CloudEvents routing
- Backward compatible: no delivery config = envelope-only (existing behavior)
- Non-fatal error collection via `delivery_errors` in result

### 4. Budget Tracking (29 tests)
- Added 4 LLM metric instruments to `RunnerInstruments` (now 9, matching Go parity)
- Ported Go's `budget.Tracker` as `BudgetTracker` — pure sandbox-safe class with cost/token/duration limit checks
- `extractCostFromOutput()` with `__stigmer_*` prefix convention and fallback to unprefixed keys (fixing Go's broken LLM-to-budget pipeline)
- Three `BudgetExceededPolicy` modes: terminate, warn, human_review

## Benefits

- Full Go parity on listen event types, notification, and OTel metrics
- Event delivery and budget tracking go beyond Go's current implementation
- 91 new tests with zero regressions (588 passing, 1 pre-existing)
- Phase 7 (Integration Testing) is now unblocked with 23 golden YAMLs

## Impact

- **Workflow authors**: can now use `notification:` tasks for fire-and-forget messaging, `emit_event` with delivery targets for cross-system integration, and all three listen event types
- **Platform operators**: OTel LLM metrics provide full observability, budget tracking enables cost control
- **Phase 7 readiness**: all supporting infrastructure is in place for integration testing

## Related Work

- Follows Phase 6 partial completion in Session 11 (claimcheck, OTel, heartbeat, baggage)
- Enables Phase 7: Integration Testing (23 golden YAMLs)
- Budget tracker ports Go's `pkg/budget/tracker.go` with improvements

---

**Status**: Production Ready
**Timeline**: 1 session (~45 minutes)
