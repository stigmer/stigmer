# Gap B2: Event Deduplication for Durable Signal Delivery

**Date**: February 8, 2026

## Summary

Implemented Gap B2 (Event Dedupe) to prevent duplicate signal processing when external events (webhooks, API callbacks, human approvals) are retried. This provides idempotent signal delivery using an idempotency key mechanism with configurable TTL, ensuring that duplicate signals return the same response without re-triggering workflow logic.

## Problem Statement

External events delivered via the `SendSignal` RPC can be duplicated due to:
- Network retries from webhook providers (Stripe, GitHub, etc.)
- Client-side retries on timeout
- At-least-once delivery semantics

### Pain Points

- Same webhook event delivered multiple times could unblock a LISTEN task repeatedly
- Race conditions between duplicate signals
- No way for callers to safely retry signal delivery
- Webhook providers expect idempotent handling

## Solution

Implemented a dedupe store mechanism that:
1. Accepts an optional `idempotency_key` on `SendSignalInput`
2. Claims the key atomically before signal delivery
3. Returns `ALREADY_EXISTS` for duplicate keys within TTL window
4. Marks key as delivered after successful Temporal signal delivery

The solution uses database-level unique constraints for atomic claim operations, with TTL-based automatic expiration (24 hours default, matching Stripe's idempotency window).

## Implementation Details

### Proto API Changes

Added `idempotency_key` field to `SendSignalInput` in `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto`:
- Optional string field (field number 4)
- Comprehensive documentation explaining format, scope, and TTL
- Backward compatible - existing callers without key get same behavior

### Go Implementation (stigmer)

New package: `backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe/`

**SignalDedupeStore interface:**
- `Claim(ctx, org, key, executionID, signalName, ttl)` - Atomic claim with unique constraint
- `MarkDelivered(ctx, org, key)` - Update status after successful delivery

**SQLiteSignalDedupeStore implementation:**
- Uses SQLite for local CLI server
- TTL-based cleanup on claim operations
- Composite key format: `{org}:{idempotency_key}`

**Pipeline Integration:**
- Added `DedupeClaimStep` after validation (before Temporal signal)
- Added `DedupeMarkDeliveredStep` after successful signal delivery
- Graceful degradation if dedupe store unavailable

### Java Implementation (stigmer-cloud)

New package: `ai.stigmer.domain.agentic.workflowexecution.dedupe`

**Components:**
- `SignalDedupeRecord` - MongoDB document with TTL index on `expiresAt`
- `SignalDedupeRepo` - Spring Data MongoDB repository
- `SignalDedupeStore` - Service with `claim()` and `markDelivered()` methods

**Pipeline Integration:**
- Added `DedupeClaimStep` and `DedupeMarkDeliveredStep` to `WorkflowExecutionSendSignalHandler`
- Uses `DuplicateKeyException` for atomic claim detection
- Non-critical steps (failure doesn't block signal delivery)

### Unit Tests

Created comprehensive test suite in `signal_dedupe_store_test.go`:
- Claim new key succeeds
- Claim duplicate key returns duplicate
- Same key different org succeeds (per-org scoping)
- TTL expiration allows key reuse
- Mark delivered updates status
- Table and index creation verification

## Benefits

- **Idempotent Webhook Handling**: Safely receive webhook retries without duplicate processing
- **Client Retry Safety**: API clients can retry on timeout without side effects
- **Industry Standard**: 24-hour TTL matches Stripe, GitHub, and other major webhook providers
- **Backward Compatible**: Existing integrations work unchanged; opt-in for new callers
- **Graceful Degradation**: Dedupe failures don't block signal delivery

## Impact

- **Workflow Executions**: All workflows using LISTEN tasks benefit from dedupe protection
- **Webhook Integrations**: Stripe, GitHub, Slack, and custom webhooks can safely retry
- **API Callers**: CLI, SDK, and direct API users can provide idempotency keys
- **Cloud & Local**: Implementation works in both stigmer-cloud (MongoDB) and local CLI (SQLite)

## Related Work

- **Gap B1**: Signal-With-Start (prerequisite - race-proof signal delivery)
- **Durability Research**: `research.tool-idempotency-storage-patterns/04.report.gpt.md`
- **Project**: `20260208.01.durable-agentic-workflows`

## Files Changed

**stigmer (Proto + Go)**:
- `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto` - Added idempotency_key field
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/workflowexecution_controller.go` - Added dedupe store field
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/send_signal.go` - Added dedupe pipeline steps
- NEW: `backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe/signal_dedupe_store.go`
- NEW: `backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe/signal_dedupe_store_test.go`

**stigmer-cloud (Java)**:
- `backend/services/stigmer-service/.../WorkflowExecutionSendSignalHandler.java` - Added dedupe steps
- NEW: `backend/services/stigmer-service/.../dedupe/SignalDedupeStore.java`
- NEW: `backend/services/stigmer-service/.../dedupe/SignalDedupeRecord.java`
- NEW: `backend/services/stigmer-service/.../dedupe/SignalDedupeRepo.java`

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
**Gap Reference**: Gap B2 (Event Dedupe) from Durable Agentic Workflows project
