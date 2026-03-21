# Fix Zero Token Usage: Dict Access Bug in StatusBuilder

**Date**: March 21, 2026

## Summary

Fixed the root cause of zero token usage and `$0.00` cost display in the execution cost panel. The `usage_metadata` extraction code was using `getattr()` on a `TypedDict` (plain `dict` at runtime), causing all token counts to silently default to zero for every LLM provider.

## Problem Statement

Agent executions consistently reported `$0.00 / 0 tokens` in the `ExecutionCostSummary` panel despite completing real work with measurable token consumption. Diagnostic logging (added in a prior commit) confirmed that `usage_metadata` was populated with correct values — but the extraction code failed to read them.

### Pain Points

- Every agent execution across all LLM providers (Anthropic, OpenAI, Ollama) showed zero usage
- Cost tracking was completely non-functional
- The bug was invisible in unit tests because `MagicMock` objects support attribute access, masking the dict-vs-attribute mismatch

## Solution

Replaced `getattr()` calls with dict `.get()` calls for reading `usage_metadata` keys. `UsageMetadata` is a `TypedDict` from `langchain-core` — a plain Python `dict` at runtime where keys must be accessed via `[]` or `.get()`, not `getattr()`. Updated all test fixtures from `MagicMock` to real dictionaries to prevent future regressions.

## Implementation Details

**File**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

- Unified the two-branch extraction logic into a single path that resolves `usage_metadata` from either an `AIMessage` attribute or raw dict, then uses `.get()` uniformly
- Added fallback for OpenAI-style key names (`prompt_tokens`, `completion_tokens`) alongside LangChain's standard keys (`input_tokens`, `output_tokens`)
- Downgraded the `[USAGE_DIAG]` diagnostic log from `info` to `debug` — it served its purpose and no longer needs to appear in production logs

**File**: `backend/services/agent-runner/tests/test_status_builder.py`

- Replaced all 15 instances of `MagicMock(input_token_details=None)` and bare `MagicMock()` used for `usage_metadata` with actual Python dictionaries matching the real `TypedDict` shape
- Tests now accurately reflect runtime behavior and will catch any future dict-vs-attribute regression

## Benefits

- Token usage and cost display now works correctly for all LLM providers
- Tests use realistic data structures that match production runtime behavior
- Diagnostic logging preserved at `debug` level for future troubleshooting

## Impact

- **All LLM providers**: Anthropic, OpenAI, Ollama — this was a universal bug in `langchain-core`'s `UsageMetadata` handling, not provider-specific
- **All 279 tests pass** with the fix and updated fixtures
- **User-facing**: Execution cost panel will now show accurate token counts and estimated costs

## Related Work

- Diagnostic logging addition: `2026-03-21-091330-diagnostic-logging-zero-token-usage.md`
- `ExecutionCostSummary` component (`sdk/react/src/execution/ExecutionCostSummary.tsx`)
- `UsageTracker` cost calculation (`backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`)

---

**Status**: ✅ Production Ready
