# Diagnose LLM Text Content Dropping

**Date**: February 24, 2026

## Summary

Added diagnostic logging to detect whether LLM text content is being silently dropped during streaming. The diagnostic compares the full text from the `on_chat_model_end` final output against what was accumulated token-by-token during streaming, logging a `[CONTENT_DROP]` warning on mismatch.

## Problem Statement

After fixing the LLM stream token interleaving bug, agent messages appeared as very short fragments ("Now", "Now let me read") that seemed truncated. It was unclear whether the model genuinely produces only brief text before tool calls (normal with extended thinking) or whether content is being silently dropped during the streaming pipeline.

### Pain Points

- No way to distinguish between "model said little" and "we lost content"
- The thinking detection early-return path could theoretically drop co-located text blocks
- Debugging required manual inspection of raw API responses

## Solution

A zero-side-effect diagnostic block in `_handle_chat_model_end_event` that extracts the full text from the LLM's final output and compares it with the accumulated streamed content. Wrapped in `try/except` to guarantee no impact on execution.

## Implementation Details

- Added to `status_builder.py` in `_handle_chat_model_end_event`, after the AI message is finalized
- Extracts text from `output_data.content` (handles both object attributes and dict keys, both string and list content)
- Logs `[CONTENT_DROP] WARNING` with both texts (truncated to 200 chars), lengths, run_id, and namespace on mismatch
- Logs `[CONTENT_OK] DEBUG` on match

## Benefits

- Definitively answers whether content is being dropped or model output is genuinely brief
- Zero runtime cost on the happy path (DEBUG level only)
- Points directly to the bug if content IS being dropped

## Impact

- **Agent Runner**: Diagnostic only -- no behavioral changes
- **Operations**: New `[CONTENT_DROP]` log entries will surface in agent-runner logs if truncation occurs

## Related Work

- Fix LLM stream token interleaving (2026-02-24-022248)
- Think tool streaming UX (2026-02-24-012820)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
