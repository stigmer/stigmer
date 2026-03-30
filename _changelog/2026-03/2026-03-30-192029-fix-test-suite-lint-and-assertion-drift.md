# Fix Test Suite Lint Errors and Stale Assertions

**Date**: March 30, 2026

## Summary

Resolved all `make check` failures caused by dead test code, stale test assertions, and an unused import. Three test files and one lint auto-fix were addressed to bring the suite back to green (1437 passed, 0 failed).

## Problem Statement

`make check` was failing with 9 lint errors and 2 test failures:

### Pain Points

- **9 `F821` lint errors** in `test_tool_wrappers.py`: The `TestStreamWriteContent` class referenced `_stream_write_content`, a function that had been removed from `graphton.core.tool_wrappers`. The class was marked `@pytest.mark.skip` so tests never ran, but the linter still flagged the undefined name.
- **`test_workspace_rule_covers_read_and_execute` failure** in `test_skill_writer.py`: The `generate_prompt_section` output format was refactored to use inline examples (`read {location}/...`, `execute(...)`) instead of bold section headers (`**Reading**`, `**Executing scripts**`, `$STIGMER_PLATFORM_DIR`), but the test assertions were never updated.
- **`test_reconcile_clears_result` failure** in `test_status_builder.py`: The reconcile logic in `streaming_buffers.py` was updated to preserve streamed results when input content was already buffered (`had_input_content` guard), but the test still expected the result to be cleared unconditionally.
- **Unused import** in `test_subagent_guardrails.py`: `_TOOL_COUNT_WARNING_THRESHOLD` was imported but no longer used.

## Solution

- Removed the dead `TestStreamWriteContent` class entirely (133 lines of unreachable test code).
- Updated `test_workspace_rule_covers_read_and_execute` assertions to match the current prompt template format.
- Updated the reconcile test to assert `tc.result == "hello"` (preserved) instead of `""` (cleared), and renamed it to `test_reconcile_preserves_result_when_input_was_streamed` to reflect the actual production behavior.
- The unused import was auto-fixed by the linter during `make check`.

## Impact

- `make check` now passes cleanly: **1437 passed, 10 skipped, 0 failed, 0 lint errors**.
- No production code was changed — all fixes are test-only.

## Files Changed

| File | Change |
|------|--------|
| `backend/libs/python/graphton/tests/core/test_tool_wrappers.py` | Removed dead `TestStreamWriteContent` class |
| `backend/services/agent-runner/tests/test_skill_writer.py` | Updated assertions for current prompt format |
| `backend/services/agent-runner/tests/test_status_builder.py` | Fixed reconcile test to match preserve-result behavior |
| `backend/libs/python/graphton/tests/core/test_subagent_guardrails.py` | Removed unused import (auto-fix) |

---

**Status**: ✅ Production Ready
