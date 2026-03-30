# Unify Tool Error Handling and Contracts

**Date**: March 30, 2026

## Summary

Established a consistent error-handling contract across all LLM tool wrappers in graphton: tool wrappers own user-facing responses, backends own filesystem operations, and wrappers defensively check backend results before crafting their own messages. This closes the last tool-layer inconsistencies in the filesystem backend standardization project (T03 of 4).

## Problem Statement

The LLM tool wrappers in `tool_wrappers.py` had inconsistent contracts for how they handled backend results and communicated errors to the model.

### Pain Points

- The `edit` tool silently dropped the return value of `backend.write()`, meaning a backend that returned an error object (like `DeepAgentsBackendAdapter.write`) would not be caught -- the tool would report success to the LLM while the write had failed
- The `delete` tool passed the backend's return string through verbatim to the LLM, leaking the backend's message format into the tool wrapper's contract
- The `delete` tool had two identical `except` blocks doing the same thing
- The `grep` tool returned bare error strings for invalid regex, bypassing the `enrich_error_message` path that every other tool uses for errors

## Solution

Applied a single unifying principle: **tool wrappers own user-facing responses, backends own filesystem operations.** This means every mutation tool (write, edit, delete) defensively checks backend results via `getattr(result, "error", None)` and crafts its own success/error messages.

Three of the five original T03 scope items were eliminated after investigation:
- `bytes` vs `str` unification -- non-issue, all backends accept `str`
- `execute` shell failure formatting -- correct as-is, non-zero exit codes are operational results
- Directory deletion in `delete` tool -- correct as-is, file-only design with `execute rm -rf` for directories

## Implementation Details

**edit tool** (`tool_wrappers.py`): Added `result = await asyncio.to_thread(backend.write, ...)` capture and `getattr(result, "error", None)` check, matching the `write` tool's defensive pattern. On error, returns `enrich_error_message("edit", str(error))`.

**delete tool** (`tool_wrappers.py`): Replaced `return result` (backend passthrough) with `return f"Deleted '{path}'"`. Collapsed two identical `except (FileNotFoundError, IsADirectoryError, ValueError)` and `except Exception` handlers into a single `except Exception`.

**grep tool** (`tool_wrappers.py`): Wrapped invalid regex early return in `enrich_error_message("grep", f"Invalid regex pattern '{pattern}': {e}")` for consistent error format.

**test_tool_wrappers.py**: Fixed pre-existing broken import (`_stream_write_content` was removed from source but still imported). Added `test_edit_returns_error_when_write_fails` and `test_edit_succeeds_when_write_returns_none`. Updated `test_grep_invalid_regex` to assert enriched error format.

## Benefits

- Consistent error contract: every tool error the LLM sees follows the `Error: ...\n\nRecovery suggestions:\n- ...` format from `enrich_error_message`
- The `edit` tool now catches backend write failures that were previously silently ignored
- Tool wrapper responses are decoupled from backend message formats -- backends can change their return strings without breaking the LLM-facing contract
- Pre-existing test collection failure fixed, unblocking 137 tool wrapper tests

## Impact

- **graphton library**: `tool_wrappers.py` (+24/-9 lines), `test_tool_wrappers.py` (+40/-3 lines)
- **Test results**: 1346/1346 core tests pass, 103/103 daytona backend tests pass, 28/28 error enrichment tests pass
- **Scope reduction**: Investigated and eliminated 3 of 5 original items, resulting in a smaller, more focused change

## Related Work

- Part of the filesystem backend standardization project (T03 of 4)
- Builds on T01 (Daytona shell execution fix) and T02 (sealed `__getattr__`)
- Remaining: T04 (Consolidate Platform Mount and Display Humanization)

---

**Status**: Production Ready
**Timeline**: ~1 session
