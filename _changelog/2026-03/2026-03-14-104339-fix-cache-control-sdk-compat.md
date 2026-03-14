# Fix cache_control SDK Compatibility in Prompt Caching Layer 3

**Date**: March 14, 2026

## Summary

Fixed a `TypeError` in automatic conversation caching (Layer 3) where `cache_control` was passed as a top-level kwarg to `AsyncMessages.create()`, which fails on anthropic SDK versions older than 0.83.0. Switched to using `extra_body` for version-agnostic compatibility.

## Problem Statement

After Phase 4B of the usage-metrics-cost-optimization project introduced automatic conversation caching, agent executions began failing with:

```
[TypeError] AsyncMessages.create() got an unexpected keyword argument 'cache_control'
```

### Pain Points

- All agent executions using Anthropic models failed immediately on first API call
- The deployed agent-runner (on `main`) uses anthropic SDK 0.79.0, which does not accept `cache_control` as a first-class kwarg on `messages.create()`
- The feature branch upgraded to 0.84.0 (which supports it), but the deployment had the old SDK

## Solution

Changed Layer 3 of `_inject_cache_control()` to route `cache_control` through the `extra_body` parameter instead of setting it as a top-level payload key. The `extra_body` parameter is supported by all versions of the anthropic SDK — it gets merged into the HTTP request body without needing to be a recognized keyword argument.

## Implementation Details

**Production change** (`graphton/core/models.py`):

Before:
```python
if "cache_control" not in payload:
    payload["cache_control"] = _CACHE_CONTROL_EPHEMERAL
```

After:
```python
extra = payload.setdefault("extra_body", {})
if isinstance(extra, dict) and "cache_control" not in extra:
    extra["cache_control"] = _CACHE_CONTROL_EPHEMERAL
```

**Test changes** (`tests/core/test_prompt_caching.py`):
- Updated 8 assertions across 3 test classes to check `payload["extra_body"]["cache_control"]` instead of `payload["cache_control"]`
- All 30 prompt caching tests pass

### Why `extra_body` Works

When langchain-anthropic calls the Anthropic API, it unpacks the payload dict as `**payload` into `messages.create()`. The `extra_body` parameter is accepted by all SDK versions (it's part of the base httpx client wrapper) and gets merged into the JSON request body. This means `cache_control` reaches the API without needing to be a recognized method parameter.

## Benefits

- Agent executions no longer crash on anthropic SDK < 0.83.0
- Automatic conversation caching still works correctly on all SDK versions
- Forward-compatible: when all environments upgrade to 0.84.0+, the behavior is identical

## Impact

- **Who**: All agent executions using Anthropic models
- **Severity**: Blocking — executions failed on first API call
- **Scope**: 2 files changed (1 production, 1 test)

## Related Work

- Phase 4B: Automatic Conversation Caching (`2026-03-14-034725-phase-4b-conversation-caching-and-dep-upgrade.md`)
- Anthropic SDK upgrade from 0.79.0 → 0.84.0 (feature branch only, not yet on `main`)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
