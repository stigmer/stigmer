# Fix Agent Runner Startup Crash: `await` Outside Async Function

**Date**: March 3, 2026

## Summary

Fixed a `SyntaxError` that prevented the agent-runner worker from starting. The `_handle_tool_start_event` method used `await` to call an async sub-agent handler but was itself a synchronous function, causing a fatal import-time error.

## Problem Statement

The agent-runner worker crashed on startup with:

```
SyntaxError: 'await' outside async function (status_builder.py, line 604)
```

This prevented the Temporal worker from registering any activities, making the entire agent execution pipeline non-functional.

### Pain Points

- Agent-runner completely unable to start — no agent executions could run
- Error surfaced at import time during activity registration, blocking all functionality

## Solution

Made `_handle_tool_start_event` an async method and updated the event dispatcher in `process_event` to handle both sync and async handlers transparently using `inspect.isawaitable()`.

## Implementation Details

Three targeted changes in `status_builder.py`:

1. **Added `import inspect`** — standard library module for awaitable detection
2. **Changed `_handle_tool_start_event` from `def` to `async def`** — allows the method to properly `await` the async `_handle_sub_agent_start` call
3. **Updated handler dispatch in `process_event`** — the dispatcher now captures the handler's return value and awaits it if it's an awaitable, keeping all existing sync handlers (`_handle_tool_end_event`, `_handle_chat_model_stream_event`, etc.) working unchanged

## Benefits

- Agent-runner starts successfully again
- Sub-agent task tracking (`_handle_sub_agent_start`) works correctly with its async LLM subject generation
- Future async handlers can be added without modifying the dispatcher

## Impact

- **Agent Runner**: Restores full functionality — worker can register activities and process executions
- **Existing handlers**: No behavioral change for sync handlers; the `inspect.isawaitable` check is a no-op for them

---

**Status**: Production Ready
