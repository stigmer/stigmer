# SSE Usage Parser for Proxy-Side Billing Metering

**Date**: May 4, 2026

## Summary

Implemented an incremental, push-based SSE parser that extracts token usage from OpenAI and Anthropic streaming responses in the proxy layer. This is the foundational building block (T01) for tamper-proof billing — enabling the proxy to observe provider-reported token counts directly from the SSE stream, rather than trusting runner-attested billing data.

## Problem Statement

The agent runner is open source. A user who forks it can modify `UsageTracker` to report zero tokens via `updateStatus` or `ReportLlmCallUsage`, getting free LLM usage on Stigmer's platform API keys. Both billing surfaces today are runner-attested with no server-side verification.

### Pain Points

- Runner-reported billing data is trivially tamperable
- No server-side verification of LLM usage exists
- The proxy layer sees all LLM traffic but currently treats it as opaque bytes
- Billing accuracy depends entirely on client honesty

## Solution

Created a reusable SSE parsing library (`ai.stigmer.proxy.usage`) that segments raw byte streams into SSE events, then extracts token usage from provider-specific JSON payloads. The parser is designed for push-based, incremental processing — suitable for a "tee" topology where bytes are forwarded to the client AND parsed simultaneously without buffering the full response.

## Implementation Details

**Architecture**: Two-layer separation — SSE protocol parsing (provider-agnostic) and usage extraction (provider-specific).

**Package**: `ai.stigmer.proxy.usage` with sub-package `sse/` for wire protocol concerns.

**Key classes**:
- `SseFrameDecoder` — W3C-compliant SSE protocol parser handling line buffering, `\n`/`\r\n`/`\r` delimiters, BOM stripping, field accumulation, and event dispatch via callback
- `OpenAiUsageExtractor` — extracts `prompt_tokens`/`completion_tokens` from the final chunk (when `stream_options.include_usage: true`)
- `AnthropicUsageExtractor` — extracts input/output/cache tokens from `message_start` + `message_delta` events
- `SseUsageExtractorFactory` — provider routing with no-op fallback for unknown providers
- `ParsedLlmUsage` — immutable result record

**Design principles**:
- Push model: callers feed bytes via `onBytes(byte[], offset, length)`, ask for result via `finish()`
- Infallible: parsing failures produce `Optional.empty()`, never exceptions
- Memory-bounded: buffers only the current line, not the full response
- Zero impact on stream forwarding: parser failures are isolated

**Test coverage**: 40 unit tests across 4 test classes, using realistic SSE fixtures captured from OpenAI and Anthropic response formats.

## Benefits

- Enables tamper-proof billing metering (T02 will wire this into the proxy controllers)
- Pure, isolated utility — testable without infrastructure dependencies
- Incremental processing adds negligible latency to the streaming path
- Provider-extensible via factory pattern (Cursor format can be added in T03)
- De-risks the hardest technical unknown (SSE parsing) before touching proxy controllers

## Impact

- **Billing security**: Foundation for preventing free-riding via tampered runners
- **Architecture**: Establishes the proxy usage extraction pattern that T02/T03 will build on
- **Code organization**: New `ai.stigmer.proxy.usage` package provides clean separation from controller code

## Related Work

- Parent project: `20260503.03.stripe-billing-integration` (Phase 2 — Execution Enforcement)
- Sub-project: `20260504.01.sp.proxy-side-billing-metering`
- Next: T02 (wire parser into LlmProxyController + billing calls), T05 (dual-header access control)

---

**Status**: Production Ready
**Commit**: `7f0882b5` on `feat/stripe-billing-integration` branch (stigmer-cloud)
