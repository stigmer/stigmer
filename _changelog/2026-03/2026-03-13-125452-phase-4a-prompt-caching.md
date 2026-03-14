# Phase 4A: Anthropic Prompt Caching (System Prompt + Tool Schemas)

**Date**: March 13, 2026

## Summary

Added Anthropic prompt caching by injecting `cache_control: {"type": "ephemeral"}` breakpoints on the system prompt and last tool definition in the existing `_EagerToolStreamingChatAnthropic._get_request_payload()` payload-patching method. This caches the entire static prefix (system + tools) across all LLM calls in a conversation, yielding ~80% savings on the repeated portion of every request.

## Problem Statement

Every LLM call in an agentic loop repeats the same system prompt (~3K tokens) and tool schemas (~10K tokens). With 5-15 calls per execution, this means 65K-195K tokens billed at full rate for content that never changes within a conversation.

### Pain Points

- **Full-price repetition**: System prompt and tool definitions sent at 1.0x rate on every single LLM call, despite being identical across calls
- **No caching opt-in**: Anthropic's prompt caching requires explicit `cache_control` markers; without them, automatic caching does not apply
- **Compounding cost**: In agentic loops with many tool calls, the static prefix becomes the dominant component of input token costs

## Solution

Extended the existing `_EagerToolStreamingChatAnthropic._get_request_payload()` method — which already patches the Anthropic API payload for eager tool streaming and adaptive thinking — to also inject `cache_control` breakpoints. No prompt restructuring was needed; the Anthropic API already separates `system`, `tools`, and `messages` into distinct payload parameters.

## Implementation Details

### Key Architectural Insight

The original T01 master plan called for "restructuring prompt construction to place static content as a stable prefix." Investigation revealed this was unnecessary — LangChain's `ChatAnthropic._get_request_payload()` already builds the payload with `system`, `tools`, and `messages` as separate top-level parameters. The work was purely additive: inject `cache_control` markers at the right places.

### `_inject_cache_control()` (`graphton/core/models.py`)

Pure function that mutates the API payload in place with two layers:

- **Layer 1 — System prompt**: If the `system` parameter is a string (the common case), converts it to a content block list with `cache_control`. If already a list of blocks, adds `cache_control` to the last block. Skips `None` or empty values.
- **Layer 2 — Tool definitions**: Adds `cache_control` to the last tool in the `tools` list. This caches everything from the system prompt through all tool schemas as a single cacheable prefix.

Both layers are idempotent — existing `cache_control` markers are never overwritten.

### `_EagerToolStreamingChatAnthropic`

- New `_prompt_caching: bool` private attribute (default `True`) — enables test opt-out without polluting the public API
- `_get_request_payload()` calls `_inject_cache_control(payload)` when `_prompt_caching` is `True`
- Always-on for Anthropic: cache write costs 1.25x but reads cost 0.1x; break-even at 2 calls, which every agentic execution exceeds

### Tests (`tests/core/test_prompt_caching.py`)

24 tests across 6 test classes:

- `TestInjectCacheControlSystem` (7 tests): string prompt conversion, list-of-blocks, single block, None, missing key, empty string, empty list
- `TestInjectCacheControlSystemIdempotency` (2 tests): existing markers preserved, string re-conversion
- `TestInjectCacheControlTools` (5 tests): last tool marked, single tool, empty list, missing key, existing markers
- `TestInjectCacheControlCombined` (3 tests): both layers together, messages untouched, realistic payload
- `TestPromptCachingFlag` (2 tests): default enabled, opt-out
- `TestGetRequestPayloadIntegration` (5 tests): end-to-end through `_get_request_payload()` with system, tools, opt-out, eager streaming coexistence, effort coexistence

## Benefits

- **~80% savings on static prefix**: 13K tokens × 10 calls = 130K at full rate → 24.7K effective tokens with caching
- **Zero configuration**: Always-on for Anthropic, transparent to `create_deep_agent()` callers
- **Zero risk**: Cache writes cost 1.25x but reads cost 0.1x; break-even at 2 calls
- **Consistent with existing patterns**: Same payload-patching approach used for eager tool streaming and adaptive thinking

## Impact

- **Cost reduction**: Every Anthropic-backed agent execution immediately benefits from prompt caching without any configuration changes
- **Agent-runner**: No changes needed — caching is internal to the graphton library's model class
- **Observability**: Cache hit/miss metrics are already captured by `UsageTracker` via `usage_metadata.input_token_details.cache_read` / `cache_creation` (implemented in Phase 3)

## Related Work

- **Phase 3** (Usage Metrics Population): Added cache token extraction from `usage_metadata` in `StatusBuilder` — this now has data to report
- **Phase 3B** (Cost Cap): `CostCapMiddleware` already uses cache-aware pricing — prompt caching feeds it real cache hit data
- **Phase 4B** (Deferred): Incremental conversation caching via `AnthropicPromptCachingMiddleware` — would cache conversation history between turns for additional savings

---

**Status**: Production Ready
**Timeline**: ~1 hour implementation + testing
