# Agent Self-Correction Enhancement

## Problem Statement

The Stigmer agent runner lacks self-correcting behavior compared to production-grade agents like Cursor. When encountering errors:
- Agent gives up after first failure instead of trying alternatives
- Loop detection thresholds (3 consecutive, 5 total) are too aggressive
- Error messages provide no recovery hints to help the LLM adapt
- System prompts lack error recovery guidance

## Solution

Enhance the graphton library to make agents resilient and self-correcting:

1. **Cursor-style System Prompts** - Add comprehensive error recovery guidance (~800-1200 words)
2. **Tuned Loop Detection** - Increase thresholds to allow 7 consecutive / 20 total attempts
3. **Error Message Enrichment** - Add contextual recovery hints based on error patterns
4. **Configurable Parameters** - All settings configurable with optimal defaults

## Key Changes

| Component | Change |
|-----------|--------|
| `prompt_enhancement.py` | Added resilience preamble + error recovery strategies |
| `agent.py` | New `loop_*` parameters with optimal defaults |
| `config.py` | Validation for loop detection parameters |
| `authenticated_tool_node.py` | `_enrich_error_message()` helper |

## Status

**COMPLETE** - All implementation done, ready for testing and review.

## Files Modified

- `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py`
- `backend/libs/python/graphton/src/graphton/core/agent.py`
- `backend/libs/python/graphton/src/graphton/core/config.py`
- `backend/libs/python/graphton/src/graphton/core/authenticated_tool_node.py`

## Files Created

- `backend/libs/python/graphton/tests/core/test_prompt_enhancement.py`
- `backend/libs/python/graphton/tests/core/test_config.py`
- `backend/libs/python/graphton/tests/core/test_error_enrichment.py`

## Related

- Plan: `.cursor/plans/agent_self-correction_enhancement_fb2c7a8f.plan.md`
- Branch: `feat/env-runtime-vars-flow`
