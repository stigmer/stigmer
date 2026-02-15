# Fix Approval-Gated Tool Result Extraction

**Date**: February 15, 2026

## Summary

Fixed a critical bug where approval-gated tools (Write, Execute, etc.) displayed raw Python `CommandUpdate(...)` repr strings instead of clean, human-readable results in the CLI TUI. The issue occurred when tools went through the interrupt/resume approval cycle in LangGraph. The fix implements two layers: a root-cause fix in the backend's result extraction logic and a defense-in-depth safety net in the CLI rendering layer.

## Problem Statement

When users approved tool executions through the HITL (human-in-the-loop) approval workflow, the CLI would display garbled output like `CommandUpdate('messages': [ToolMessage(content='Successfully wrote 42 characters...', tool_call_id='...')])` instead of the clean result `"Successfully wrote 42 characters to 'foo.txt'"`.

This affected all approval-gated tools, making the execution output difficult to read and understand, degrading the user experience significantly during interactive approval workflows.

### Pain Points

- CLI displayed raw Python object repr strings for all approved tool executions
- Affected Write, Execute, Delete, and all other tools requiring approval
- Users saw technical internals instead of meaningful results
- The garbled output made it difficult to verify that approved operations succeeded
- Screenshot evidence showed the Write tool output rendered as a single unbroken line
- Issue was invisible during normal (non-approval) tool execution

## Solution

Implemented a two-layer defense strategy:

**Layer 1 - Backend Root Cause**: Enhanced the `_extract_tool_result_content()` method in `status_builder.py` to recognize and properly handle LangGraph `Command` objects that are returned during approval resume cycles. The method now uses duck-typing to detect Command objects and extracts the ToolMessage content from the `Command.update["messages"]` state channel.

**Layer 2 - CLI Defense-in-Depth**: Extended the `stripToolMessageRepr()` function in the CLI's `format.go` to detect and clean `CommandUpdate(...)` repr strings that might leak through, extracting any embedded ToolMessage content as a safety net.

## Implementation Details

### Backend Changes (`status_builder.py`)

1. **Command Detection Branch** (lines 723-729):
   - Added duck-typed detection: `hasattr(result, "update") and isinstance(result.update, dict)`
   - Positioned between existing `.content` check and `dict` check
   - Once identified as Command, commits to extraction (no fallthrough to repr)

2. **Helper Method `_extract_command_content()`** (lines 820-859):
   - Searches `Command.update["messages"]` for ToolMessage objects
   - Handles both string and multimodal (list) content
   - Falls back to JSON serialization of non-messages state channels
   - Returns empty string if no meaningful content found

3. **Warning Log on Fallback** (lines 739-742):
   - Added `logger.warning()` when unknown types hit the `str()` fallback
   - Prevents future unknown types from silently producing garbage
   - Logs type name and 200-char preview for debugging

### CLI Changes (`format.go`)

1. **Extended `stripToolMessageRepr()`** (lines 137-172):
   - Added Pattern 2 detection for `CommandUpdate(` prefix
   - Delegates to new helper function `extractCommandUpdateContent()`

2. **Helper Function `extractCommandUpdateContent()`** (lines 174-196):
   - Scans for `ToolMessage(content='...')` or `ToolMessage(content="...")` patterns
   - Extracts quoted content value from within CommandUpdate repr
   - Returns original string if no ToolMessage content found (graceful degradation)

### Test Coverage

**Backend Tests** (`test_status_builder.py`):
- Added `_FakeCommand` test double (lines 1015-1023)
- 9 new test cases covering:
  - Command with ToolMessage string content
  - Command with multiple messages (first wins)
  - Command with multimodal content
  - Empty messages list fallback
  - Missing messages key fallback
  - Empty update dict
  - Empty content ToolMessage
  - Non-Command objects with `.update = None`
  - End-to-end integration test

**CLI Tests** (`render_test.go`):
- 8 new test cases covering:
  - CommandUpdate with single-quoted content
  - CommandUpdate with double-quoted content
  - CommandUpdate without extractable ToolMessage
  - CommandUpdate with empty content
  - Content with embedded quotes
  - Direct `extractCommandUpdateContent()` function tests

All 21 Python tests pass (12 existing + 9 new). All Go toolrender tests pass.

## Technical Deep Dive

### Root Cause Analysis

When LangGraph resumes from an `interrupt()`, the event pipeline changes:

```
Normal Flow:
  Tool returns "Success" → on_tool_end.data.output = "Success" → Extraction → "Success"

Approval Resume Flow:
  Tool returns "Success" → interrupt() → resume → on_tool_end.data.output = Command(update={...}) → Extraction → ???
```

The `Command` object wraps the state update mutations. The actual tool result lives in `Command.update["messages"]` as a `ToolMessage` object. The extraction method didn't recognize this type, so it fell through to `str(result)`, which called Python's `__repr__()` and produced the garbled string.

### Why Duck Typing

The solution uses duck typing (`hasattr(result, "update")`) rather than importing `langgraph.types.Command` to:
- Stay decoupled from LangGraph internals
- Match the existing pattern used for ToolMessage detection
- Avoid import dependencies in the status builder
- Support future LangGraph API changes

### CLI Defense Rationale

Even though the backend fix resolves the root cause, the CLI defense layer provides:
- Protection against future edge cases
- Robustness if backend extraction has gaps
- Consistency with existing `stripToolMessageRepr()` defensive pattern
- No performance cost (only activates on malformed input)

## Benefits

- **User Experience**: Approval-gated tool outputs now display clean, readable results
- **Debugging**: Warning logs now surface unknown result types instead of silent failures
- **Robustness**: Two-layer defense prevents repr leakage from multiple sources
- **Consistency**: All tools now have uniform output formatting regardless of approval state
- **Maintainability**: Comprehensive test coverage prevents regressions

## Impact

### Users
- Approval workflows now show meaningful tool results
- CLI output is readable and professional
- Verification of approved operations is straightforward

### Developers
- Backend status extraction handles all known LangGraph result shapes
- CLI rendering has defense-in-depth against repr leakage
- Clear warning logs surface future edge cases early

### System
- No performance impact (duck typing is fast)
- No breaking changes to public APIs
- Backwards compatible with existing tool result formats

## Related Work

- LangGraph interrupt/resume documentation: https://langchain-ai.github.io/langgraph/how-tos/review-tool-calls/
- Command type reference: https://langchain-ai.github.io/langgraph/reference/types/
- Related to approval workflow enhancements in prior changelogs
- Builds on existing ToolMessage repr stripping patterns

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (investigation + implementation + testing)  
**Affected Components**: Backend (agent-runner), CLI (toolrender)  
**Test Coverage**: 17 new tests, all existing tests pass
