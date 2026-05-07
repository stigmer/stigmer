# Cursor Proxy Usage Metering (T04)

**Date**: May 4, 2026

## Summary

Extended proxy-side billing metering to the Cursor harness by implementing a `CursorUsageExtractor` and wiring conditional SSE tee-streaming into `CursorProxyController`. Both LLM and Cursor proxy paths now independently meter token usage for tamper-proof billing.

## Problem Statement

The `LlmProxyController` (T03) meters OpenAI/Anthropic usage, but the `CursorProxyController` was still relaying streams verbatim with no usage capture. Cursor-harness executions — which constitute a significant portion of platform traffic — had zero proxy-side billing visibility.

### Pain Points

- Cursor executions relied entirely on runner-attested usage (untrusted)
- No proxy-side token counts for Cursor models
- Billing gap between LLM and Cursor harness paths

## Solution

Research-first approach: analyzed the `@cursor/sdk` source to determine the wire format (standard SSE with `turn-ended` events containing per-turn token counts), then implemented a purpose-built extractor and conditional tee loop.

## Implementation Details

- **CursorUsageExtractor**: Reuses `SseFrameDecoder` for SSE framing, parses JSON payloads for `turn-ended` events, accumulates tokens across multiple turns per run, extracts model from `assistant` events
- **Conditional tee in CursorProxyController**: Only SSE responses (`Content-Type: text/event-stream`) are parsed; non-SSE traffic (agent CRUD, analytics RPC) passes through unchanged
- **SseUsageExtractorFactory**: Added `"cursor"` case alongside `"openai"` and `"anthropic"`
- **Shared billing pipeline**: Reuses `ProxyUsageReporter`, `ProxyCallSequencer`, `ProxyTiming` — identical billing path for all three providers

Key architectural finding: Cursor's streaming path uses REST + SSE at `api.cursor.com`, not gRPC-Connect. The `api2.cursor.sh` host handles Connect RPC for SDK analytics only.

## Benefits

- Tamper-proof billing now covers all three proxy paths (OpenAI, Anthropic, Cursor)
- Zero overhead for non-streaming Cursor traffic (conditional tee)
- Multi-turn accumulation handles Cursor's agent loop pattern correctly
- Robust parsing handles both camelCase and snake_case token field names

## Impact

- **Billing**: Cursor-harness executions are now metered at the proxy level
- **Architecture**: Completes the proxy-side metering layer for all supported providers
- **Security**: Removes dependency on runner-reported Cursor usage

## Related Work

- T01: SSE Usage Parser (`2026-05-04-140917`)
- T02: Layered Usage Metering Model (`2026-05-04-163031`)
- T03: LlmProxyController Wiring (`2026-05-04-165632`)
- Parent: Stripe Billing Integration (`20260503.03`)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~30 minutes implementation after research)
