# Diagnostic Logging for Zero Token Usage in Execution Cost Panel

**Date**: March 21, 2026

## Summary

Added diagnostic logging to `StatusBuilder._handle_chat_model_end_event` to capture the exact shape of `output_data` at the point where token usage is extracted. The execution cost panel displays `$0.00 / 0 tokens · 1 call` despite the agent completing work, indicating the usage extraction logic is silently falling through.

## Problem Statement

Completed agent executions show zero token usage and zero cost in the `ExecutionCostSummary` panel. The `record_llm_call()` fires (call count = 1) and the model name is extracted from `response_metadata`, but all four token buckets — input, output, cache creation, cache read — remain at zero.

### Pain Points

- Users see `$0.00` and `0 tokens` for executions that clearly consumed tokens (thinking, tool calls, output generation)
- No visibility into what `output_data` actually contains when the extraction code runs
- The usage extraction has two branches (`usage_metadata` object and `dict` fallback) but no logging when both are skipped

## Solution

A single `logger.info` call placed immediately before the usage extraction block in `_handle_chat_model_end_event`. It captures runtime evidence on every `on_chat_model_end` event without modifying any control flow.

## Implementation Details

**File**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

The diagnostic log captures:
- `type(output_data).__name__` — confirms whether it's `AIMessage`, `AIMessageChunk`, `ChatGenerationChunk`, or something unexpected
- `output_data.usage_metadata` — the actual value (`None`, partial, or populated)
- `response_metadata` keys and its `usage` sub-dict — whether Anthropic's raw usage data is available as a fallback

Tagged with `[USAGE_DIAG]` for easy grep in production logs.

## Benefits

- Enables evidence-driven debugging of the zero-usage issue instead of speculative fixes
- No behavior change — purely additive logging
- Will reveal the root cause on the next execution: LangChain version bug, extended thinking interference, or unexpected data shape

## Impact

- **Agent Runner**: One new `logger.info` call per `on_chat_model_end` event
- **No user-facing changes**: This is backend observability only
- **All 279 existing tests pass** with the addition

## Related Work

- `ExecutionCostSummary` component (`sdk/react/src/execution/ExecutionCostSummary.tsx`)
- `UsageTracker` cost calculation (`backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`)
- `ModelRegistry` pricing (`backend/libs/python/graphton/src/graphton/core/model_registry.py`)

---

**Status**: ✅ Production Ready (diagnostic instrumentation)
