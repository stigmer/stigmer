# Connect RPC Metering for Cursor Proxy

**Date**: May 30, 2026

## Summary

Added proxy-side token usage metering for Connect RPC traffic from the Cursor SDK's local mode (`api2.cursor.sh`). Previously, Connect responses passed through the proxy unmetered, requiring the runner-reported `recordCursorUsage` fallback for billing. The proxy now extracts usage from Connect protobuf envelopes using a minimal wire-format scanner, making it the billing authority for both SSE (cloud mode) and Connect (local mode) Cursor traffic.

## Problem Statement

The Cursor SDK uses two transport protocols depending on execution mode:
- **Cloud mode**: REST + SSE on `api.cursor.com` -- metered by `CursorUsageExtractor` (JSON parsing)
- **Local mode** (default): Connect RPC on `api2.cursor.sh` -- passed through as opaque binary, unmetered

Since local mode is the majority of Cursor traffic, billing for most executions relied on runner-reported `streaming_usage` via `recordCursorUsage`. This data is `DISPLAY_ONLY` trust -- reported by open-source runner code running on user-controlled machines, with no independent verification.

### Pain Points

- Billing from unverified runner-reported token counts
- Trust ladder violation: `DISPLAY_ONLY` data used as billing authority
- Proxy metering gap for the dominant Cursor transport protocol
- Two separate billing paths (proxy SSE vs runner fallback) with potential for divergence

## Solution

Built a three-layer Connect metering pipeline that extracts token usage from Connect RPC response streams at the proxy level, using the same tee pattern as the existing SSE metering:

1. **ConnectEnvelopeDecoder** -- pure Connect protocol decoder (5-byte header: flags + big-endian length + payload)
2. **ProtobufFieldScanner** -- minimal protobuf wire-format navigator that traverses field paths without generated stubs
3. **ConnectCursorUsageExtractor** -- navigates `AgentServerMessage.interaction_update.turn_ended` to extract four token counts

## Implementation Details

**Proto field path** (extracted from `@cursor/sdk` v1.0.11 bundle):
```
AgentServerMessage
  field 1: interaction_update (InteractionUpdate)
    field 14: turn_ended (TurnEndedUpdate)
      field 1: input_tokens (int64)
      field 2: output_tokens (int64)
      field 3: cache_read_tokens (int64)
      field 4: cache_write_tokens (int64)
```

**Key design decision: minimal protobuf scanner vs generated stubs**

Rather than depending on Cursor's private proto schema (which would require maintaining generated Java classes and tracking Cursor SDK updates), we built a `ProtobufFieldScanner` that navigates the protobuf wire format using known field numbers. Protobuf guarantees field numbers are contractually stable -- Cursor can add new fields (safely skipped) but cannot renumber existing ones without breaking all clients.

**Content-type routing**: `SseUsageExtractorFactory` generalized with `create(provider, contentType)` overload. `application/proto`, `application/connect+proto`, `application/grpc` trigger the Connect extractor; `text/event-stream` uses the existing SSE extractor.

**Defensive fallback**: `recordCursorUsage` is preserved. Both paths generate the same idempotency key (`{executionId}_1_PROXY_PROVIDER_REPORTED`), so the existing dedup in `RecordLlmCallUsageHandler` ensures whichever writes first wins. The proxy usually wins the race since it reports immediately after stream completion, while `recordCursorUsage` runs after workflow finalization.

**Observability**: Micrometer counters for `connect.streams_metered`, `connect.turns_extracted`, `connect.decode_failures`, `connect.zero_usage_streams`.

### New files (stigmer-cloud)

| File | Purpose |
|------|---------|
| `proxy/usage/connect/ConnectEnvelope.java` | Decoded envelope record |
| `proxy/usage/connect/ConnectEnvelopeDecoder.java` | Push-based Connect wire-format decoder |
| `proxy/usage/connect/ProtobufFieldScanner.java` | Minimal protobuf field navigator |
| `proxy/usage/ConnectCursorUsageExtractor.java` | Cursor-specific usage extraction |

### Modified files (stigmer-cloud)

| File | Change |
|------|--------|
| `proxy/cursor/CursorProxyController.java` | Content-type detection, Connect metering path, Micrometer counters |
| `proxy/usage/SseUsageExtractorFactory.java` | Generalized with content-type awareness |
| `BUILD.bazel` | 3 new test targets |

### Test coverage

- `ConnectEnvelopeDecoderTest`: 10 tests (single/multi/chunked/flags/zero-payload/offset)
- `ProtobufFieldScannerTest`: 8 tests (varint/length-delimited/nested/missing)
- `ConnectCursorUsageExtractorTest`: 12 tests (single/multi turn, factory routing, chunked, compressed skip, empty stream)

All 30 new + 7 existing proxy/billing tests pass.

## Benefits

- **Proxy-authoritative billing**: the proxy observes all Cursor traffic (SSE and Connect), eliminating the need for runner-reported billing
- **Trust ladder compliance**: proxy-observed records carry `BILLING_AUTHORITY` trust, matching the trust ladder design
- **Zero runner dependency**: once validated in production, `recordCursorUsage` can be removed entirely
- **No schema dependency**: the minimal protobuf scanner has no dependency on Cursor's private proto schema or generated stubs

## Impact

- **Billing accuracy**: all Cursor executions now produce proxy-observed billing records, regardless of transport protocol
- **stigmer-cloud only**: all changes are in the cloud repo's proxy layer. OSS repo, runner, and SDK are unaffected
- **Non-breaking**: `recordCursorUsage` is preserved as a fallback. The change is additive -- new metering alongside existing billing path

## Related Work

- Phase 1: Cursor Admin API polling + global event ledger (completed 2026-05-29)
- Phase 2: Settlement proto scaffolding (`UsageSettlementStatus`, `is_estimated`, `SettlementLink`) -- committed same session
- Trust ladder design: `_projects/2026-05/20260529.01.cursor-billing-reconciliation/design.trust-ladder.md`

---

**Status**: Production Ready (pending staging validation)
**Timeline**: 1 session (~90 minutes implementation + testing)
