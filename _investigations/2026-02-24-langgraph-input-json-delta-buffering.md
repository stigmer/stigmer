# Why LangGraph Buffers `input_json_delta` Events Instead of Streaming Them

**Date**: February 24, 2026
**Status**: Open investigation
**Goal**: Understand why `input_json_delta` tokens from the Anthropic API arrive as a single burst through LangGraph's `astream_events()` instead of streaming progressively, and determine how to fix it.

## The Problem

When the LLM generates tool arguments (e.g., file content for a `write` tool), the Anthropic API streams `input_json_delta` tokens one at a time over ~30 seconds. However, LangGraph's `astream_events(version="v2")` does NOT yield these as individual `on_chat_model_stream` events in real-time. Instead, it buffers them internally and releases them all at once in a ~2-second burst right before the tool node starts executing.

This prevents the CLI from showing file content progressively as it's generated. The user stares at a static tool header ("Write: file.py") for 30 seconds before all content appears at once with the approval prompt.

## Evidence from Server Logs

Execution `aex-01kj7rn84c7ampg4knwb43pavn` on the running agent-runner container:

### Timeline

```
12:06:13.695  [TOOL_EARLY]  tool=write  temp_id=early-toolu_01KYodfrPaJTpU8ZNnVt78KV
                            namespace=model:1eee1f0e-4f16-3a0b-8983-6d616e424175

              ── 30-second gap: NO on_chat_model_stream events emitted ──

12:06:43.235  [STREAM]      First gRPC update after the gap
                            events_total=367  (only 9 events in 30 seconds)
                            tool_calls=12

12:06:43.459  [STREAM]      burst_protection  events_total=417  (+50 in 214ms)
12:06:43.637  [STREAM]      burst_protection  events_total=467  (+50 in 169ms)
12:06:43.707  [STREAM]      burst_protection  events_total=517  (+50 in 50ms)
12:06:43.752  [STREAM]      burst_protection  events_total=567  (+50 in 41ms)
...           (hundreds more events in rapid succession)

12:06:45.356  [STREAM_DIAG] block_types=['input_json_delta']  (first of hundreds)
12:06:45.383  [STREAM_DIAG] block_types=['input_json_delta']  (last batch)

12:06:45.531  [TOOL_RECONCILE]  tool=write  on_tool_start fires
```

### Key Observations

1. The `tool_use` block (tool name + ID) arrives at `12:06:13` via `on_chat_model_stream` -- this works and triggers `_create_early_tool_call()`.

2. Between `12:06:13` and `12:06:43` (30 seconds), only **9 events** arrive from `astream_events()`. The `events_processed` counter goes from 358 to 367. During this time, the Anthropic API is streaming hundreds of `input_json_delta` tokens, but LangGraph is not yielding them.

3. At `12:06:43`, events suddenly burst: 50 events every ~50-200ms. The `input_json_delta` `[STREAM_DIAG]` logs all cluster at `12:06:45.356-45.383` (27ms window for the final batch).

4. `on_tool_start` fires at `12:06:45.531` -- just 176ms after the last `input_json_delta` log.

5. For comparison, **thinking streaming works correctly**: `[THINK] streaming_started` at `12:05:55`, `streaming_completed` at `12:05:58` (3 seconds of progressive streaming). Thinking blocks use `type: "thinking"` and stream through `on_chat_model_stream` in real-time. The same mechanism fails for `input_json_delta`.

## Architecture Context

### How the Agent Graph is Built

```
execute_graphton.py
  └── create_deep_agent()                    (graphton/core/agent.py)
        └── deepagents.create_deep_agent()   (external: deepagents==0.4.0)
              └── Returns CompiledStateGraph  (standard LangGraph)
```

- `deepagents` version: `0.4.0` (pinned: `>=0.4.0,!=0.4.1,<0.5.0`)
- `langchain-anthropic` version: `1.3.3` (pinned in poetry.lock)
- `langchain-core` version: `>=1.0.0`
- The graph is invoked with standard `astream_events(version="v2")`
- No custom wrapper around `astream_events()` -- it's called directly on the `CompiledStateGraph`

### How Events Flow

```
Anthropic API
  │  content_block_start  type=tool_use     ← arrives early, works fine
  │  content_block_delta  type=input_json_delta  ← streamed token-by-token
  │  content_block_delta  type=input_json_delta
  │  ... (hundreds over 30 seconds)
  │  content_block_stop
  │  message_stop
  ▼
langchain-anthropic ChatAnthropic._astream()
  │  Converts each API event to AIMessageChunk
  │  content_block_start → AIMessageChunk(content=[{"type":"tool_use",...}])
  │  content_block_delta → AIMessageChunk(content=[{"type":"input_json_delta","partial_json":"..."}])
  ▼
LangGraph chat model node (inside deepagents graph)
  │  ??? BUFFERING HAPPENS HERE ???
  ▼
LangGraph astream_events(version="v2")
  │  on_chat_model_stream events
  │  tool_use block yields immediately
  │  input_json_delta blocks: ALL arrive in a 2-second burst at the end
  ▼
StatusBuilder.process_event()
  │  _create_early_tool_call() ← works, but only on tool_use block
  │  _accumulate_tool_input()  ← receives all deltas at once, too late
  ▼
gRPC update → CLI
```

### Where Buffering Likely Happens

The buffering is between `ChatAnthropic._astream()` and the `on_chat_model_stream` events yielded by `astream_events()`. Three possible locations:

1. **LangGraph's chat model node implementation**: LangGraph's built-in `call_model` node might collect all streaming chunks internally before routing to the tool node. If it accumulates the full `AIMessage` before deciding which edge to follow (text response vs tool call), the streaming events would only be emitted once the decision is made.

2. **`deepagents` custom node**: If `deepagents` wraps the chat model call in a custom node that uses `model.ainvoke()` instead of `model.astream()`, streaming would be lost entirely. However, we DO see `on_chat_model_stream` events (thinking and tool_use blocks work), so the model IS streaming. The issue is specific to `input_json_delta` blocks.

3. **LangGraph's event routing with `astream_events`**: The v2 schema might batch certain event types or delay forwarding events from nested nodes until a checkpoint boundary.

## Relevant Source Files

- **StatusBuilder** (event consumer): `backend/services/agent-runner/worker/activities/graphton/status_builder.py`
  - `_handle_chat_model_stream_event()` -- line 748
  - `_create_early_tool_call()` -- line 1364
  - `_accumulate_tool_input()` -- line 1573

- **Event loop** (main loop): `backend/services/agent-runner/worker/activities/execute_graphton.py`
  - `astream_events()` call -- line 2478
  - Update scheduler -- line 2541

- **Graph creation**: `backend/libs/python/graphton/src/graphton/core/agent.py`
  - `create_deep_agent()` -- wraps `deepagents.create_deep_agent()`

- **External dependency**: `deepagents==0.4.0` (not in repo, installed via pip)

## What Needs Investigation

1. **How does `deepagents.create_deep_agent()` build the chat model node?** Does it use LangGraph's built-in `ChatModel` node wrapper, or a custom function node? If custom, does it call `model.astream()` or `model.ainvoke()`?

2. **How does LangGraph's `astream_events(v2)` handle streaming from chat model nodes?** Specifically, when a chat model produces a tool call, does LangGraph buffer the streaming chunks until the full message is assembled (to determine routing), or does it forward chunks in real-time?

3. **Is there a LangGraph configuration option to enable real-time chunk forwarding?** For example, `stream_mode` parameters or callback configurations that affect how `on_chat_model_stream` events are emitted.

4. **Does the `thinking` block type stream differently because it's handled before the routing decision?** Thinking blocks stream correctly (3 seconds of progressive output). They arrive before any tool_use blocks. The tool_use block itself also arrives immediately. Only `input_json_delta` blocks (which come AFTER tool_use) are buffered. This suggests the buffering is related to LangGraph waiting for the complete tool call before routing.

## Reproduction

Run any execution that triggers a `write` tool with substantial content (e.g., creating a file with 100+ lines). Monitor the agent-runner logs filtered by:

```
docker logs stigmer-agent-runner 2>&1 | grep -E "\[TOOL_EARLY\]|\[STREAM_DIAG\].*input_json_delta|\[STREAM\].*execution=<ID>"
```

Compare the timestamp of `[TOOL_EARLY]` (when tool_use block arrives) with the timestamps of `[STREAM_DIAG]` entries showing `input_json_delta`. The gap between them is the buffering window.
