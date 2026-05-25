# Task T01: v3 Streaming Migration -- Technical Plan

**Created**: 2026-05-25
**Status**: PENDING REVIEW
**Type**: Migration

## Problem Statement

The Native path (ExecuteDeepAgent) cannot extract structured output because:

1. `createDeepAgent` delegates to `createAgent`/`ReactAgent` (NOT the deprecated `createReactAgent`)
2. Structured output is produced inside the `model_request` node as an `UntrackedValue`
3. `UntrackedValue` is **never checkpointed** -- stripped during checkpoint writes (`pregel/loop.js`)
4. Stigmer uses v2 `streamEvents()` which does not provide a final state object
5. `getState()` reads from checkpoints, so it will never contain `structuredResponse`

The deepagents-intended API for accessing `structuredResponse` from streaming is v3's `run.output` / `run.values`.

## Current Architecture (v2)

```
streaming.ts: streamExecution()
  └─ agentGraph.streamEvents(input, config, { version: "v2" })
     └─ Returns AsyncIterable<StreamEvent> (LangChain callback events)
     └─ StatusBuilder.processEvent() maps events to proto status
     └─ StreamingUpdateScheduler controls persist cadence
     └─ Heartbeat, stall detection, cancellation checks per event
     └─ InlinePublisher + WriteBackCoordinator on on_tool_end
```

Key v2 event types consumed by StatusBuilder:
- `on_chat_model_stream` -- token streaming
- `on_chain_start` / `on_chain_end` -- node lifecycle
- `on_tool_start` / `on_tool_end` -- tool execution
- `on_chat_model_end` / `on_llm_end` -- model completion

## Target Architecture (v3)

```
streaming.ts: streamExecution()
  └─ agentGraph.streamEvents(input, config, { version: "v3" })
     └─ Returns GraphRunStream (deepagents DeepAgentRunStream)
        ├─ run.values -- AsyncIterable of state snapshots (incremental)
        ├─ run.output -- Promise<MergedAgentState> (final state with structuredResponse)
        ├─ run.updates -- per-node state updates
        └─ run.subagents -- subagent streams (if any)
```

v3 changes:
- Events are **protocol events** (not LangChain callbacks)
- Stream transformers (createSubagentTransformer, etc.) ARE applied in v3
- `run.output` resolves to the full state including `structuredResponse`
- StatusBuilder needs to consume v3 event shapes instead of v2 callback events

## Files Affected

| File | Impact | Complexity |
|------|--------|------------|
| `streaming.ts` | Core rewrite of stream consumption loop | HIGH |
| `status-builder.ts` | Event type mapping (v2 callbacks → v3 protocol events) | HIGH |
| `index.ts` | Read `structuredResponse` from `run.output` | LOW |
| `streaming-scheduler.ts` | May need adjustment for v3 event cadence | MEDIUM |
| `setup.ts` | No change (responseFormat already passed correctly) | NONE |
| Offline tests | Mock LLM may need v3-compatible event emission | MEDIUM |
| Provider tests | Should work once streaming is migrated | LOW |

## Key Investigation Questions (T01 scope)

Before writing code, we need to answer:

1. **v3 event shape mapping**: What are the exact v3 protocol event types? How do they map to the v2 events StatusBuilder consumes? Read `deepagents/node_modules/langchain/dist/agents/ReactAgent.js` lines 648-666 and the v3 stream types.

2. **Heartbeat compatibility**: Can we still heartbeat per-event in v3, or does the event cadence change?

3. **Cancellation semantics**: Does `isCancelledFn` work the same way with v3 async iterables?

4. **InlinePublisher / WriteBackCoordinator**: These listen for `on_tool_end` events. What's the v3 equivalent?

5. **HITL interrupts**: How are interrupts surfaced in v3 streaming?

6. **Mock LLM compatibility**: Does `MockLLMProxyServer` need changes for v3?

## Phased Migration Plan

### Phase 1: v3 API Investigation (1-2 sessions)
- Read v3 protocol event types from deepagents/langchain source
- Build a mapping table: v2 event → v3 event
- Write a small test script that runs a deepagents agent with v3 streaming and logs all events
- Confirm `run.output` contains `structuredResponse`

### Phase 2: StatusBuilder v3 Adapter (1-2 sessions)
- Create a v3 event adapter that translates v3 events to StatusBuilder's expected format
- OR rewrite StatusBuilder to consume v3 events natively
- Decision depends on Phase 1 findings

### Phase 3: Streaming Loop Migration (1-2 sessions)
- Rewrite `streamExecution()` to use v3 `streamEvents()`
- Iterate `run.values` for streaming updates
- Maintain heartbeat, stall detection, cancellation
- Read `structuredResponse` from `await run.output` after completion

### Phase 4: Structured Output Extraction (1 session)
- Wire `structuredResponse` from `run.output` into `index.ts`
- Remove the "v3 migration pending" log message
- Set `initialStatus.structuredOutput` from the result

### Phase 5: Test Validation (1-2 sessions)
- Update offline test mocks if needed for v3 compatibility
- Run full offline test suite
- Run provider tests for both Native and Cursor paths
- Run `make test-integration-all`

## Success Criteria

1. Native path structured output tests pass (`TestAgentExecution_StructuredOutputPipeline` native subtests)
2. All existing streaming behavior preserved (heartbeats, stall detection, HITL, inline publishing, writeback)
3. Offline tests pass with v3 streaming
4. Full `make test-integration-all` passes with zero regressions
5. No wasted LLM calls -- `structuredResponse` comes from `run.output`, not a separate extraction call

## Risks

1. v3 event shapes may differ significantly from v2, requiring StatusBuilder rewrite
2. v3 streaming may have different cancellation/pause semantics
3. deepagents stream transformers activate in v3, potentially changing visible event set
4. Performance characteristics may differ (batching, buffering)
5. Mock LLM proxy may need updates for v3 event format

## Prior Art / References

- deepagents `ReactAgent.streamEvents()` v3 path: `node_modules/deepagents/node_modules/langchain/dist/agents/ReactAgent.js` lines 648-666
- `GraphRunStream` API: `node_modules/@langchain/langgraph/dist/stream/run-stream.d.ts`
- v3 protocol event types: `node_modules/@langchain/langgraph/dist/stream/types.js`
- Previous investigation chat: [Structured Output Pipeline Fix](a39f3a46-ef41-4b7b-bc05-ad6f24b1e009)
- Current session findings documented in: `_cursor/fix-structured-output-pipeline.md`
