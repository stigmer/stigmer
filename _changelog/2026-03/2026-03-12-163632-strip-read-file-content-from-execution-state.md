# Strip read_file Content from Persisted Execution State

**Date**: March 12, 2026

## Summary

Eliminated verbatim file content storage from `read_file` tool call results in the persisted AgentExecution state. The full content is replaced with a lightweight placeholder (`[content omitted - N chars]`) while preserving the file path in `tc.args` and the original char count in `message.content`. This targets the single largest contributor to execution state bloat — a typical execution with 60 `read_file` calls was inflated from ~1 MB of structural data to 4.7 MB by duplicated file content that is never consumed downstream.

## Problem Statement

Every `read_file` tool call in `StatusBuilder._handle_tool_end_event` stored the entire file content verbatim in `tc.result`. For an agent execution that reads many files (changelogs, proto definitions, source code), this caused massive state inflation.

### Pain Points

- A single execution with 60 `read_file` calls produced a 56,281-line / 4.7 MB state object
- Each changelog read (~200-400 lines of markdown) was stored in full, often duplicated across both message-level and tool_calls-level structures
- The read content was never consumed from the persisted state by any downstream system — it exists purely as ephemeral LLM context during execution
- The same content is already available in the LangGraph checkpoint DB and on disk
- Larger state objects mean slower DB reads/writes, larger wire payloads, and more memory pressure

## Solution

Added a `_READ_ONLY_TOOLS` constant and a 4-line conditional in `_handle_tool_end_event` that replaces the full result with a size-only placeholder for read-only tools, while preserving the original content for `_format_tool_message_content` so CLI display retains accurate char counts.

### Key Design Decision

The stripping happens at the point where `tc.result` is assigned (4 sites), not at extraction time. This means `_format_tool_message_content` still receives the original `tool_result_content` and produces correct summaries like `"read_file() -> 7046 chars"`. The `persisted_result` variable holds either the placeholder or the full content depending on tool type.

## Implementation Details

### Constant

```python
_READ_ONLY_TOOLS: set[str] = {"read_file"}
```

Defined alongside the existing `_TOOL_CONTENT_FIELDS` dict. The set is extensible if other read-only tools are identified in the future.

### Logic in `_handle_tool_end_event`

After extracting the tool result content, compute the persisted variant:

```python
tool_result_content = self._extract_tool_result_content(tool_result_raw)

if tool_name in _READ_ONLY_TOOLS:
    persisted_result = f"[content omitted - {len(tool_result_content)} chars]"
else:
    persisted_result = tool_result_content
```

Then `persisted_result` is used at the 4 `tc.result` / `tool_call.result` assignment sites (sub-agent messages, sub-agent tool_calls, main agent messages, main agent tool_calls).

### What stays the same

- `tc.args` — file path preserved as-is (the useful metadata for display)
- `message.content` — still formatted with original char count via `_format_tool_message_content`
- grep/glob/search/list_dir results — untouched (compact, useful structural metadata)
- write/edit/think tool results — untouched (represent mutations and reasoning)
- Tool progress streaming — `read_file` is not in `_TOOL_CONTENT_FIELDS`, has no streaming phase

## Benefits

- **~70% state size reduction** for read-heavy executions (4.7 MB → ~1-1.5 MB estimated)
- Faster DB persistence and retrieval of execution state
- Smaller wire payloads to frontend/CLI
- Lower memory pressure on the agent-runner service
- No loss of information — file paths retained, full content available in checkpoint DB

## Impact

- **agent-runner service**: Smaller execution state objects persisted to DB
- **CLI/frontend**: No visible change — `message.content` summaries are unchanged
- **Checkpoint DB**: Unaffected — still stores full LangGraph message history
- **Future extensibility**: `_READ_ONLY_TOOLS` set can be extended for other read-only tools if needed

## Files Changed

### Modified (1 file)

- `backend/services/agent-runner/worker/activities/graphton/status_builder.py`
  - Added `_READ_ONLY_TOOLS` constant (line ~197)
  - Added `persisted_result` computation in `_handle_tool_end_event` (line ~872)
  - Changed 4 `tc.result` assignments from `tool_result_content` to `persisted_result`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
