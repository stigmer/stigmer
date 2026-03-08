# Fix Adaptive Thinking `effort` Parameter Placement

**Date**: March 8, 2026

## Summary

Fixed a 400 Bad Request error when using Claude Opus 4.6 / Sonnet 4.6 models with adaptive thinking. The `effort` parameter was incorrectly nested inside the `thinking` dict instead of being sent as a separate `output_config` API parameter.

## Problem Statement

After switching models to Claude 4.6 generation, all agent executions using adaptive thinking failed with:

```
Error code: 400 - thinking.adaptive.effort: Extra inputs are not permitted
```

### Pain Points

- All agent executions on Claude Opus 4.6 were completely broken
- The error was opaque — the API rejected the request at the schema level with no workaround

## Solution

Moved the `effort` parameter out of the `thinking` dict and into `output_config`, matching the Anthropic API specification:

- **Before** (broken): `thinking: {"type": "adaptive", "effort": "medium"}`
- **After** (correct): `thinking: {"type": "adaptive"}` + `output_config: {"effort": "medium"}`

Since `langchain-anthropic` v1.3.3 does not natively support `output_config`, the fix injects it at the API payload level via the existing `_EagerToolStreamingChatAnthropic` subclass — the same pattern already used for `eager_input_streaming`.

## Implementation Details

### `graphton/core/models.py`

- Added `_effort` as a Pydantic `PrivateAttr` on `_EagerToolStreamingChatAnthropic`
- Updated `_get_request_payload` to inject `output_config: {"effort": ...}` into the outgoing API payload when `_effort` is set
- Changed the adaptive thinking branch in `parse_model_string` to set `thinking: {"type": "adaptive"}` (no `effort` inside) and store the effort value on the instance after construction

### `tests/core/test_models.py`

- Updated `test_adaptive_thinking_for_opus_4_6` to assert `effort` is NOT in the `thinking` dict and instead lives on `model._effort`

## Benefits

- Unblocks all Claude 4.6 adaptive thinking executions
- Correctly follows Anthropic's API contract for `output_config.effort`
- Reuses the existing payload-patching pattern — minimal code surface change

## Impact

All agent executions using `claude-opus-4.6` (and any future model with `supports_adaptive_thinking=True`) are now functional.

## Related Work

- Adaptive thinking support was originally added in the native extended thinking feature work
- The `_EagerToolStreamingChatAnthropic` subclass was introduced for fine-grained tool streaming

---

**Status**: ✅ Production Ready
