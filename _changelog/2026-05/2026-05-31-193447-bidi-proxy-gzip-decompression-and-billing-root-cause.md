# BiDi Proxy: Gzip Decompression Fix & Billing Root-Cause Analysis

**Date**: May 31, 2026

## Summary

Root-caused and partially fixed the billing failure in the Cursor BiDi proxy. The original assumption (JSON end-of-stream trailers confusing the decoder) was wrong. The actual issues are: (1) Cursor responds with `connect-content-encoding: gzip` — envelope payloads are gzip-compressed, and the extractor was skipping them; (2) the runner's Connect RPC client doesn't send `x-stigmer-execution-id`, so the proxy can't associate the stream with a billable execution.

## Problem Statement

After the BiDi proxy routing fix (session 5), traffic flows end-to-end through the proxy but `ProxyUsageReporter` emits zero billing records. The integration test shows `STREAMING_USAGE: input=10247 output=29` (runner reports correctly) but `EXECUTION_REPORT: input=0 output=0 calls=0` (proxy doesn't bill).

### Pain Points

- Billing is completely broken for cursor harness executions via the BiDi proxy
- The error was misdiagnosed in session 5 as "JSON end-of-stream trailers"
- No production users affected (cursor harness not yet live)

## Solution

### Issue 1: Gzip Decompression (FIXED)

Added gzip decompression to `ConnectCursorUsageExtractor.onEnvelope()`. When the upstream responds with `connect-content-encoding: gzip` (standard Connect protocol message-level compression), each envelope payload is individually gzip-compressed while the 5-byte framing remains intact. The extractor now decompresses before parsing protobuf fields.

### Issue 2: Execution ID Header (IDENTIFIED, NOT YET FIXED)

The runner's `@cursor/sdk` Connect RPC client uses native HTTP/2 (`connect-node`) and bypasses the fetch interceptor entirely. The `x-stigmer-execution-id` header is never sent on the BiDi stream. The proxy's `ProxyAuthorizationService` returns `metered=false` without an execution context, so `reportUsageQuietly()` never fires.

## Implementation Details

### Gzip Decompression (stigmer-cloud)

```java
// ConnectCursorUsageExtractor.java — before:
if (envelope.isCompressed()) {
    decodeFailures++;
    return; // skipped all compressed envelopes
}

// After:
if (envelope.isCompressed()) {
    payload = decompressGzip(envelope.payload());
    if (payload == null) { decodeFailures++; return; }
}
extractFromMessage(payload);
```

The `decompressGzip()` method uses `java.util.zip.GZIPInputStream` with graceful error handling — decompression failures are logged and skipped, never propagated.

### Investigation Method

1. Added diagnostic hex logging to `ConnectEnvelopeDecoder` (capture first bytes of each decode call)
2. Added response header logging to `CursorBidiStreamHandler`
3. Ran integration test and analyzed the wire format
4. Discovered `connect-content-encoding: gzip` in the response headers for `/agent.v1.AgentService/Run`
5. Discovered `content-encoding: br` on `BootstrapStatsig` responses (explains the "encrypted-looking" data from session 5 — it was brotli, not Connect framing)
6. Added completion-path logging — confirmed `scope.metered()=false` due to null execution ID

### Key Discovery: Multiple Non-Agent RPCs Through BiDi Proxy

The path-routing sends ALL `/agent.v1*` AND `/aiserver.v1*` requests to the BiDi proxy. This includes:
- `/aiserver.v1.DashboardService/GetUserPrivacyMode`
- `/aiserver.v1.AnalyticsService/BootstrapStatsig` (brotli-compressed!)
- `/aiserver.v1.DashboardService/GetTeamAdminSettingsOrEmptyIfNotInTeam`
- `/aiserver.v1.AnalyticsService/TrackEvents`
- `/agent.v1.AgentService/Run` (the actual agent stream)

Each creates a handler with extractors. Only the agent stream matters for billing; the rest produce harmless "invalid payload length" warnings.

## Benefits

- Gzip decompression handles the standard Connect protocol compression — the extractor is now robust regardless of upstream compression negotiation
- 6 new unit tests ensure gzip-compressed envelopes are handled correctly
- Clear next step identified (execution ID header injection) with recommended approach

## Impact

- `ConnectCursorUsageExtractor` in stigmer-cloud
- `ConnectCursorUsageExtractorTest` — 6 new test methods
- Project documentation updated with corrected root-cause analysis

## Related Work

- Session 5 routing fix (same project)
- Cursor billing trust ladder sketch (`2026-05-29-134102`)
- Next: HTTP/2 header injection for execution ID (runner-side change)

---

**Status**: In Progress (1 of 2 issues fixed)
**Timeline**: Investigation + fix in single session (~45 min)
