# Tool Error Resilience: Stop Exceptions From Killing Agent Execution

**Date**: February 24, 2026

## Summary

Platform tool exceptions (like "text to replace not found" in the edit tool) were crashing entire agent executions instead of letting the LLM self-correct. This change makes all 7 platform tools return enriched error strings instead of raising exceptions, aligning them with the resilient pattern already used by `AuthenticatedMcpToolNode`.

## Problem Statement

When an agent called the `edit` tool and the `old_text` didn't match the file contents, the tool raised a `ValueError`. LangGraph's `ToolNode` only catches `ToolInvocationError` (pydantic validation errors) by default -- all other exceptions propagate up through `astream_events()`, hit the top-level `except Exception` in `execute_graphton.py`, and set the entire execution to `EXECUTION_FAILED`.

### Pain Points

- A single mismatched text replacement killed the entire agent session
- The user lost all prior work and progress from that execution
- The LLM never received the error, so it had no opportunity to self-correct (re-read the file, adjust the text, try write instead)
- The same vulnerability existed in all 7 platform tools (read, write, edit, execute, ls, glob, grep)

## Solution

Changed all platform tools from raising exceptions to returning enriched error strings for operational failures. This is the same pattern already established by `AuthenticatedMcpToolNode`, which catches tool exceptions and returns `ToolMessage(status="error")`.

The key semantic distinction: "text not found in file" is an **expected operational failure**, not a system error. The LLM should receive it as a tool result and decide how to proceed.

## Implementation Details

### `tool_wrappers.py` (7 tools updated)

Every platform tool's `except` block was changed from:
```python
except Exception as e:
    logger.error(f"Failed to <op>: {e}")
    raise RuntimeError(f"Failed to <op>: {e}") from e
```

To:
```python
except Exception as e:
    logger.warning(f"⚠️  <tool> tool failed: {e}")
    return enrich_error_message("<tool>", str(e))
```

The `edit` tool had a special case -- `raise ValueError` for "text not found" with an explicit `except ValueError: raise` clause. Both were removed in favor of returning an enriched error string.

### `error_hints.py` (new hint pattern)

Added a targeted recovery hint for text replacement failures:
- Re-read the file to see current contents
- Use actual text from read output (content may have changed)
- Check for whitespace differences
- Fall back to write for full file replacement

## Benefits

- Agent executions no longer crash on recoverable tool errors
- LLM receives actionable recovery hints and can self-correct
- Consistent error handling across all platform tools
- Warning-level logs instead of error-level for expected failures (less alert noise)

## Impact

- **Agent reliability**: All agent executions using platform tools (edit, read, write, execute, ls, glob, grep) are now resilient to operational failures
- **User experience**: Sessions continue instead of abruptly failing
- **Observability**: Cleaner log levels -- `warning` for operational failures, `error` reserved for true system issues
- **LLM behavior**: The enriched error messages guide the agent toward productive recovery strategies

## Related Work

- `AuthenticatedMcpToolNode` already implements this pattern for MCP tools
- `error_hints.py` enrichment module was pre-existing, extended with edit-specific hints

---

**Status**: ✅ Production Ready
