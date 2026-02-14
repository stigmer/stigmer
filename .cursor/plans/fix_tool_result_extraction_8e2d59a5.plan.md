---
name: Fix Tool Result Extraction
overview: Fix `_extract_tool_result_content()` in status_builder.py to properly extract `.content` from LangGraph ToolMessage objects instead of falling through to `str()` which produces raw Python repr output. Add comprehensive unit tests.
todos:
  - id: fix-extract-method
    content: Update _extract_tool_result_content() in status_builder.py with duck-typed .content check for LangGraph message objects
    status: completed
  - id: add-unit-tests
    content: Add TestExtractToolResultContent class in test_status_builder.py with 8 unit tests + 1 integration test
    status: completed
  - id: run-tests
    content: Run the test suite to verify all new and existing tests pass
    status: completed
isProject: false
---

# Fix Backend Tool Result Extraction (Work Stream 1)

## Problem

When LangGraph sandbox tools (ls, glob, read, etc.) return `ToolMessage` objects, `_extract_tool_result_content()` in [status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py) falls through to the `str(result)` fallback on line 704, producing repr output like:

```
content="Directory '/bin/skills/a34ed6ddb7e2b131cc2cb980c89c50c563405..." name='ls' tool_call_id='to...
```

This leaks into the CLI display as garbled tool result previews.

## Root Cause

The method handles `str` and `dict`, but `ToolMessage` is neither -- it is a LangChain message object with a `.content` attribute. The `str()` fallback invokes its `__repr__`, which dumps all internal fields.

## The Fix

**File:** [status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py), lines 694-704

Insert a duck-typed `.content` attribute check between the `str` and `dict` branches:

```python
def _extract_tool_result_content(self, result: Any) -> str:
    """Extract displayable content string from a tool result.

    Handles the three result shapes that flow through LangGraph astream_events:
    - str: Direct string results (most common for simple tools)
    - LangGraph message objects (ToolMessage, AIMessage): Extract .content
    - dict: Extract from 'output'/'content' keys, or JSON-serialize
    """
    if isinstance(result, str):
        return result
    # Handle LangGraph message objects (ToolMessage, AIMessage, etc.)
    # Uses duck typing on .content to stay decoupled from langchain_core.
    if hasattr(result, "content"):
        content = result.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return self._extract_string_content(content)
    if isinstance(result, dict):
        if "output" in result:
            return result.get("output", "")
        if "content" in result:
            return str(result["content"])
        return json.dumps(result, indent=2)
    return str(result)
```

### Design decisions

- **Duck typing, not isinstance:** We use `hasattr(result, "content")` rather than importing `ToolMessage` from `langchain_core`. This keeps `status_builder.py` decoupled from the LangChain dependency (it currently has zero LangChain imports). Duck typing is appropriate because the only objects with a `.content` attribute in this pipeline are LangChain message types.
- **Multimodal content support:** When `.content` is a `list` (LangChain's multimodal content block format), we reuse the existing `_extract_string_content()` helper on line 772, which already knows how to extract text from `[{"type": "text", "text": "..."}]` blocks. This is not just theoretical -- it is the same helper used in `_handle_chat_model_stream_event`.
- **Ordering:** The new branch sits between `str` and `dict`, which is correct. Python dicts do not have a `.content` attribute, so there is no ambiguity. `ToolMessage` is not a dict subclass.

### Call sites affected (both benefit from this fix)

- `_handle_tool_end_event` (line 393) -- regular tool result extraction
- `_handle_sub_agent_end` (line 1301) -- sub-agent task tool result extraction

## Tests

**File:** [test_status_builder.py](backend/services/agent-runner/tests/test_status_builder.py)

Add a new `TestExtractToolResultContent` test class covering all branches of the method. This method currently has **zero** direct test coverage. The new tests:

1. **String passthrough** -- `str` input returns as-is
2. **ToolMessage-like object with string content** -- extracts `.content`
3. **ToolMessage-like object with list content** (multimodal) -- extracts text blocks via `_extract_string_content`
4. **ToolMessage-like object with empty content** -- returns empty string
5. **Dict with "output" key** -- returns `output` value
6. **Dict with "content" key** -- returns stringified content
7. **Dict fallback** -- JSON serializes
8. **Unknown type fallback** -- `str()` conversion
9. **Integration test** -- a ToolMessage-like object flows through `_handle_tool_end_event` end-to-end and the extracted `.content` lands in `tool_call.result`

Tests will use lightweight stub objects (not real LangChain imports) to keep the test decoupled:

```python
class FakeToolMessage:
    """Mimics langchain_core.messages.ToolMessage for testing."""
    def __init__(self, content, name="test_tool", tool_call_id="tc-123"):
        self.content = content
        self.name = name
        self.tool_call_id = tool_call_id
```

## What this does NOT change

- No new imports in `status_builder.py`
- No changes to the CLI Go code (that is work stream 2)
- No changes to `authenticated_tool_node.py` or any LangGraph agent code
- No changes to proto definitions
- The existing `str`, `dict`, and fallback branches remain unchanged

