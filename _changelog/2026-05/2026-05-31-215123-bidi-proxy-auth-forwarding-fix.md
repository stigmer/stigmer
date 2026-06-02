# BiDi Proxy: Fix Authorization Token Forwarding for Cursor Streaming

**Date**: May 31, 2026

## Summary

Fixed the Cursor BiDi proxy's `rewriteHeaders()` to conditionally forward the client's Cursor access token to upstream instead of unconditionally replacing it with the raw API key. This resolves the agent stream error introduced when Option A (`x-stigmer-auth`) separated proxy authentication from upstream authorization.

## Problem Statement

After implementing Option A (sessions 7-8), the Cursor SDK's `AgentService/Run` stream returned `status=ERROR` immediately when flowing through the BiDi proxy. The proxy connected to `api2.cursor.sh` successfully but the upstream rejected the request.

### Pain Points

- Agent executions timed out (4-minute deadline) or errored instantly
- `ConnectEnvelopeDecoder: invalid payload length 576941924` — the `0x22` byte (`"`) indicated Cursor was returning a JSON error body, not Connect RPC envelopes
- REST proxy calls (token exchange, `/v1/models`) returned 200 — the API key was valid for REST but the streaming endpoint rejected it

## Solution

Traced the full auth flow and identified that with Option A, the `authorization` header now carries the Cursor access token (from token exchange), not the Stigmer JWT. The proxy must forward it to upstream rather than replacing it.

The fix makes `rewriteHeaders()` conditional:
- **When `x-stigmer-auth` is present** (Option A): forward the client's `authorization` header to upstream as-is — it contains a valid Cursor access token obtained via token exchange
- **When `x-stigmer-auth` is absent** (legacy path): replace `authorization` with the raw API key — the header was consumed for proxy authentication

## Implementation Details

**`CursorBidiStreamHandler.java` (`rewriteHeaders` method):**
- Added `forwardClientAuth` flag based on presence of `x-stigmer-auth` header
- When true: copies client's `authorization` to upstream headers (Cursor access token)
- When false: falls back to `Bearer <cursorApiKey>` (raw API key from config)
- Backward compatible — legacy clients without `x-stigmer-auth` still work

**`config.ts` (runner):**
- Updated comment to accurately describe the Option A auth flow

## Benefits

- Agent executions through BiDi proxy now complete in ~14 seconds (vs timeout/error)
- Full bidirectional streaming works: `input=10247 output=37 turns=1`
- Token cross-reference between streaming and billing: `ratio=1.00`
- Backward compatible with legacy (non-Option A) clients

## Impact

- **BiDi proxy**: Now fully functional for agent streaming — the last auth blocker is resolved
- **Integration test**: `TestAgentExecution_CursorUsage_FullPipeline` execution completes successfully; remaining failure is a pre-existing billing cost extraction issue (model="unknown")
- **Production**: Ready for deploy once billing extraction is fixed

## Related Work

- Session 8: Option A implementation (`x-stigmer-auth` header)
- Session 9: REFUSED_STREAM fix (identity mapping + port readiness)
- Remaining: `ConnectEnvelopeDecoder` can't parse Cursor's end-of-stream trailers → model unknown → cost=0

---

**Status**: ✅ Production Ready (proxy auth)  
**Timeline**: 1 session (investigation + fix + validation)
