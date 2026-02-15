# Fix Tool Result Extraction for LangGraph ToolMessage Objects

**Date**: February 14, 2026

## Summary

Fixed `_extract_tool_result_content()` in the agent-runner's status builder to properly extract `.content` from LangGraph `ToolMessage` objects, eliminating raw Python repr leakage into CLI tool result previews. Added comprehensive test coverage for a previously untested method.

## Problem Statement

When LangGraph sandbox tools (`ls`, `glob`, `read`, etc.) returned `ToolMessage` objects, the status builder's extraction method fell through to `str()`, producing repr output that leaked internal Python metadata into the CLI display.

### Pain Points

- Tool result previews showed garbled output like `content="Directory '/bin/skills/...'" name='ls' tool_call_id='to...'` instead of clean directory listings
- `Find` tool results displayed `content="No files matching pattern '**/*.py'" name='glob' tool_call_id='...'` instead of just the message
- `Read` tool results showed no path information because the repr-corrupted result obscured the actual content
- The issue affected both main agent and sub-agent tool results (two call sites)

## Solution

Added a duck-typed `.content` attribute check in `_extract_tool_result_content()` that intercepts LangGraph message objects (`ToolMessage`, `AIMessage`) before the `str()` fallback. The check uses `hasattr` rather than `isinstance` to stay decoupled from `langchain_core` imports -- the status builder module has zero LangChain dependencies and this preserves that boundary.

## Implementation Details

**File**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

The fix inserts a new branch between the `str` and `dict` checks in `_extract_tool_result_content()`:

- When `result` has a `.content` attribute with a `str` value: return it directly
- When `result` has a `.content` attribute with a `list` value (multimodal content blocks): delegate to `_extract_string_content()` which already handles `[{"type": "text", "text": "..."}]` extraction
- All existing branches (`str`, `dict`, fallback) remain unchanged

**Design decisions**:
- Duck typing over isinstance: keeps `status_builder.py` free of LangChain imports
- Multimodal list support: reuses existing `_extract_string_content()` helper for consistency
- Ordering: the new branch sits between `str` and `dict`, which is safe because Python dicts do not have a `.content` attribute

**Tests**: `backend/services/agent-runner/tests/test_status_builder.py`

Added `TestExtractToolResultContent` class with 12 tests:
- String passthrough (2 tests: normal and empty)
- ToolMessage-like object extraction (4 tests: string content, empty content, multimodal content, empty list)
- Repr leak prevention (1 test: verifies `name=` and `tool_call_id=` never appear)
- Dict handling (3 tests: output key, content key, JSON fallback)
- Unknown type fallback (1 test)
- End-to-end integration (1 test: ToolMessage flows through `_handle_tool_end_event`)

Tests use a lightweight `_FakeToolMessage` stub to stay decoupled from LangChain.

## Benefits

- CLI tool result previews now display clean, human-readable content for all sandbox tools
- Sub-agent tool results also benefit from the same fix (shared code path)
- Zero new dependencies or imports in the production module
- The previously untested `_extract_tool_result_content()` method now has full branch coverage

## Impact

- **Agent execution CLI display**: All sandbox tool results (ls, glob, read, etc.) now render correctly
- **Sub-agent results**: Task tool completion output is also properly extracted
- **Test coverage**: 12 new tests, total suite at 163 passing

## Related Work

- Part of Work Stream 1 from the "Fix CLI Tool Display" plan
- Work Stream 2 (CLI-side defense-in-depth) and Work Stream 3 (recursion limit) are separate follow-ups

---

**Status**: Production Ready
**Commit**: `e80078e9` on `test/agent-execution-flow`
