# Task T01: v3 Streaming Migration -- Technical Plan

**Created**: 2026-05-25
**Revised**: 2026-05-26 (post deep-research report)
**Status**: READY FOR EXECUTION
**Type**: Migration

## Problem Statement

The Native path (ExecuteDeepAgent) cannot extract structured output because:

1. `createDeepAgent` delegates to `createAgent`/`ReactAgent` (NOT the deprecated `createReactAgent`)
2. Structured output is produced inside the `model_request` node as an `UntrackedValue`
3. `UntrackedValue` is **never checkpointed** -- stripped during checkpoint writes (`pregel/loop.js`)
4. Stigmer uses v2 `streamEvents()` which does not provide a final state object
5. `getState()` reads from checkpoints, so it will never contain `structuredResponse`

The deepagents-intended API for accessing `structuredResponse` from streaming is v3's `run.output` / `run.values`.

**Confirmed by deep research (local probe on @langchain/langgraph@1.3.2):** v3 `run.output` includes `UntrackedValue` fields; checkpoint-backed `getState()` omits them. This validates the migration thesis.

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
- `on_chat_model_stream` -- token streaming + thinking blocks
- `on_chat_model_end` -- mark message complete, extract usage_metadata
- `on_tool_start` -- create tool call records, approval policy checks
- `on_tool_end` -- mark tool complete, trigger artifact publish + writeback

## Target Architecture (v3)

```
streaming.ts: streamExecution()
  └─ await agentGraph.streamEvents(input, { ...config, version: "v3" })
     └─ Returns GraphRunStream (deepagents DeepAgentRunStream)
        ├─ [Symbol.asyncIterator]() -- raw ProtocolEvent stream (CANONICAL)
        ├─ run.output -- Promise<FinalState> (includes structuredResponse)
        ├─ run.values -- AsyncIterable<StateSnapshot> & PromiseLike<FinalState>
        ├─ run.messages -- typed message projection (text, reasoning, usage)
        ├─ run.subgraphs -- core LangGraph nested graph handles
        ├─ run.subagents -- deepagents-specific delegation handles
        ├─ run.lifecycle -- run/subgraph status transitions
        ├─ run.toolCalls -- LangChain agent tool execution projection
        ├─ run.interrupted / run.interrupts -- HITL state
        ├─ run.abort() / run.signal -- cancellation
        └─ run.extensions -- custom transformer projections
```

### Critical API Corrections (from deep research)

1. **v3 call signature is two-argument**, not three-argument:
   ```ts
   // CORRECT v3:
   const run = await agentGraph.streamEvents(input, { ...config, version: "v3" });
   // WRONG (v2-style):
   agentGraph.streamEvents(input, config, { version: "v3" });
   ```

2. **`run.updates` does NOT exist** on base `GraphRunStream`. Per-node state deltas arrive as raw protocol events with `event.method === "updates"`.

3. **`run.subagents` is deepagents-specific**, added via `createSubagentTransformer`. Core LangGraph has `run.subgraphs` (lower-level graph topology).

4. **Heartbeat must be independent** -- v3 has event gaps (`nostream` for structured output, long tools, subagent quiet periods). Use `setInterval`, not per-event heartbeat.

5. **Cancellation requires caller-owned AbortController** -- pass `signal` into v3 options. `run.abort()` alone does NOT cancel the underlying graph.

### v3 Protocol Event Channels

| Channel | Events | Replaces v2 |
|---------|--------|-------------|
| `messages` | `message-start`, `content-block-start`, `content-block-delta`, `content-block-finish`, `message-finish` | `on_chat_model_stream`, `on_chat_model_end` |
| `tools` | `tool-started`, `tool-output-delta`, `tool-finished`, `tool-error` | `on_tool_start`, `on_tool_end` |
| `lifecycle` | `started`, `running`, `completed`, `failed`, `interrupted` | (new) |
| `updates` | per-node state deltas `{ node, values }` | (new) |
| `values` | full state snapshots after each step | (new) |
| `checkpoints` | lightweight checkpoint envelopes | (new) |
| `input` / `input.requested` | HITL interrupt payloads | (new) |
| `custom` / `custom:<name>` | user-defined / transformer projections | (new) |
| `tasks` | Pregel task creation/result | (new) |

### v2 → v3 Event Mapping

| v2 Event | v3 Raw Protocol | Notes |
|----------|-----------------|-------|
| `on_chat_model_stream` (text) | `messages` → `content-block-delta` → `text-delta` | Content-block-level boundaries |
| `on_chat_model_stream` (thinking) | `messages` → `content-block-delta` → `reasoning-delta` | First-class reasoning support |
| `on_chat_model_end` | `messages` → `message-finish` | Usage in `data.usage` |
| `on_tool_start` | `tools` → `tool-started` | Has `tool_call_id`, `tool_name`, optional `input` |
| `on_tool_end` | `tools` → `tool-finished` | Has `output` |
| (no v2 equivalent) | `tools` → `tool-output-delta` | Streaming tool progress (async-generator tools) |
| (no v2 equivalent) | `tools` → `tool-error` | Explicit tool failure |
| `on_chain_start/end` (ignored) | `lifecycle` + `updates` + `values` | Node lifecycle, state deltas |

## Files Affected

| File | Impact | Complexity |
|------|--------|------------|
| `streaming.ts` | Core rewrite: raw protocol loop, AbortController, independent heartbeat | HIGH |
| `status-builder.ts` | New `V3StatusBuilder` consuming `StigmerRunEvent`, NOT adapter on v2 | HIGH |
| (new) `v3-protocol-normalizer.ts` | Normalize ProtocolEvent → StigmerRunEvent union type | MEDIUM |
| `index.ts` | Read `structuredResponse` from `run.output`, feature flag routing | MEDIUM |
| `streaming-scheduler.ts` | Minor: v3 event cadence may differ, but algorithm unchanged | LOW |
| `setup.ts` | No change (responseFormat already passed correctly) | NONE |
| Offline tests | Mock LLM continues as chat model; v3 protocol layer handles conversion | MEDIUM |
| Integration tests | Add v3 contract tests, regression matrix | MEDIUM |

## Key Design Decisions (Locked by Research)

1. **Raw protocol loop is canonical** -- single `for await (const event of run)` for ordering, heartbeats, cancellation, status mapping, artifact/writeback triggers
2. **Feature-flagged rollout** -- v2 fallback preserved until regression matrix passes
3. **Structured output first** -- highest value, narrowest scope, controlled blast radius
4. **Independent heartbeat** -- `setInterval(2000)`, stream events only refresh `lastActivityAt`
5. **New V3StatusBuilder** -- clean implementation against `StigmerRunEvent`, not adapter on v2 `StatusBuilder`
6. **Caller-owned AbortController** -- pass `signal` into v3 options for reliable cancellation
7. **Defensive field normalization** -- handle camelCase/snake_case inconsistencies in tool event fields

## Known Ecosystem Risks

Two bugs in our exact version family (`@langchain/core@1.1.47`, `deepagents@1.10.2`):

1. **deepagents.js #534**: v3 leaks tool results into `run.messages`, returns serialized `ToolMessage`s, can trigger `INVALID_TOOL_RESULTS` on fresh threads
2. **langchainjs #10937**: `ChatModelStream` bug where blank text + `tool_call_chunk` drops `AIMessage.tool_calls` and halts tool execution

Additionally: dependency tree can resolve multiple `@langchain/core` versions causing class identity issues. Need lockfile assertion.

## Phased Migration Plan

### Phase 0: Contract Freeze (1 session)

Record golden v2 runs as a regression baseline before writing any migration code.

**Tasks:**
- Record golden v2 runs covering: plain chat, Anthropic thinking, single tool call, tool error, file modification + artifact publish, writeback, approval interrupt, cancellation, subagent delegation, structured output
- For each golden run, save: raw v2 events, resulting `AgentExecutionStatus` proto, persisted statuses, artifacts/writebacks, token usage totals
- Add lockfile assertion for dependency versions and duplicate `@langchain/core` check
- Add CI assertion: `npm ls @langchain/core @langchain/langgraph langchain deepagents`

**Exit criteria:** Golden run corpus exists, lockfile is clean.

### Phase 1: v3 Event Recorder (1 session)

Feature-flagged v3 path that records raw protocol events without changing production behavior.

**Tasks:**
- Add `LANGGRAPH_STREAM_EVENTS_VERSION=v2|v3` environment variable
- Implement v3 recording path: call `await agentGraph.streamEvents(input, { ...config, version: "v3" })`, iterate raw events, log to structured file
- Validate event ordering by `seq`, namespace shape, tool event shape, message delta shape, usage availability
- **Confirm `run.output.structuredResponse` on a real deepagents run** with our exact versions
- Document any v3 event shapes that differ from research report expectations

**Exit criteria:** v3 events recorded and validated for all golden run scenarios. `structuredResponse` confirmed accessible via `run.output`.

### Phase 2: V3StatusBuilder + Protocol Normalizer (2-3 sessions)

Build the new v3 event processing layer alongside (not replacing) the v2 path.

**Tasks:**
- Define `StigmerRunEvent` discriminated union type (message_start, text_delta, reasoning_delta, message_finish, tool_started, tool_output_delta, tool_finished, tool_error, state_update, lifecycle, checkpoint, custom)
- Implement `V3ProtocolNormalizer` that converts raw `ProtocolEvent` → `StigmerRunEvent[]` with defensive field normalization
- Implement `V3StatusBuilder` that consumes `StigmerRunEvent` and builds `AgentExecutionStatus` proto
- Implement independent heartbeat timer (`setInterval(2000)` with `lastActivityAt` tracking)
- Implement caller-owned `AbortController` cancellation pattern
- Port all existing StatusBuilder behavior: text streaming, thinking messages, tool lifecycle, usage accumulation, approval gates, force-update flags
- Add `tool-output-delta` handling (new: streaming tool progress)
- Add `lifecycle` handling for phase transitions

**Exit criteria:** V3StatusBuilder produces identical `AgentExecutionStatus` as v2 StatusBuilder for the golden run corpus.

### Phase 3: Structured Output Path -- First User-Visible v3 Feature (1-2 sessions)

Enable v3 only when `responseFormat` is present. Maximum value, minimum blast radius.

**Tasks:**
- Wire feature flag: use v3 when `setup.hasStructuredOutput === true`, v2 otherwise
- Implement `streamExecution` v3 variant using the new V3StatusBuilder + raw protocol loop
- Read `structuredResponse` from `await run.output` after stream completes
- Handle edge cases: missing structuredResponse on interrupted/failed/cancelled runs with explicit absence reason
- Wire `structuredResponse` into `index.ts` → `initialStatus.structuredOutput`
- Remove the "v3 migration pending" log message for structured output runs
- Run structured output integration tests (native path): `TestAgentExecution_StructuredOutputPipeline`
- Run workflow structured output tests: `TestWorkflow_StructuredOutput`
- Run offline structured output tests with proper mock behavior

**Exit criteria:** Native path structured output tests pass. Structured output extracted from `run.output` without hacks.

### Phase 4: Full Streaming Parity (2-3 sessions)

Enable v3 for ALL runs behind a feature flag. Verify complete behavioral parity with v2.

**Tasks:**
- Enable v3 for all execution types (not just structured output)
- Regression matrix covering:
  - Normal ReAct tool-call turn
  - Long-running silent tools
  - Anthropic reasoning blocks
  - Approval/HITL interrupts and resume
  - Structured output runs
  - Parent + subagent runs
  - Blank leading text + tool-call chunks (ecosystem bug #10937)
  - Tool-output streaming (if async-generator tools exist)
  - Fresh-thread tool call with concurrent `run.messages` + `run.toolCalls` (ecosystem bug #534)
- Verify: text token latency, thinking messages, tool timeline, approval waits/resumes, artifact publishing timing, writeback commits, usage totals, cancellation/STOP classification, final status correctness
- Run full `make test-integration-all`

**Exit criteria:** Full test suite passes with v3. No regressions from v2 baseline.

### Phase 5: Subagent UX Upgrade (1-2 sessions)

Expose deepagents `run.subagents` as user-facing delegation tree.

**Tasks:**
- Consume `run.subagents` to create subagent cards in `AgentExecutionStatus`
- Expose: subagent name, task input/prompt, active/completed/failed state, nested tool calls, per-subagent output
- Per-subagent token usage (aggregate `message.usage` by subagent namespace)
- Namespace ownership rules to prevent double-counting messages/tools
- Update React SDK components for delegation tree UI

**Exit criteria:** Subagent delegation visible in UI as tree, not flat timeline.

### Phase 6: Custom Stigmer Stream Transformers (future)

Once v3 is stable, replace ad-hoc artifact/writeback/usage logic with native stream transformers.

**Tasks:**
- `stigmerArtifactTransformer` -- emit `custom:artifact` events on file-modifying tool completion
- `stigmerWritebackTransformer` -- emit `custom:writeback` events on git operations
- `stigmerUsageTransformer` -- aggregate token usage into `stream.extensions.usage`
- `stigmerApprovalTransformer` -- normalize approval/interrupt state
- Register transformers at compile time or call site

**Exit criteria:** Application-layer complexity reduced, Stigmer-native events available to React SDK via `custom:<name>` channels.

## Success Criteria (Overall)

1. Native path structured output tests pass (`TestAgentExecution_StructuredOutputPipeline` native subtests)
2. All existing streaming behavior preserved (heartbeats, stall detection, HITL, inline publishing, writeback)
3. V3StatusBuilder produces identical protobuf output as v2 for baseline scenarios
4. Offline tests pass with v3 streaming
5. Full `make test-integration-all` passes with zero regressions
6. `structuredResponse` comes from `run.output`, not extraction hacks
7. Feature-flagged rollout with v2 fallback until regression matrix passes
8. No duplicate `@langchain/core` in dependency tree

## Prior Art / References

- Deep Research Report: `research.v3-streaming-api-migration/04.report.gpt.md`
- deepagents `ReactAgent.streamEvents()` v3 path: `node_modules/deepagents/node_modules/langchain/dist/agents/ReactAgent.js` lines 648-666
- `GraphRunStream` API: `node_modules/@langchain/langgraph/dist/stream/run-stream.d.ts`
- v3 protocol event types: `node_modules/@langchain/langgraph/dist/stream/types.js`
- Previous investigation chat: [Structured Output Pipeline Fix](a39f3a46-ef41-4b7b-bc05-ad6f24b1e009)
- Current session findings documented in: `_cursor/fix-structured-output-pipeline.md`
- LangGraph Event Streaming docs: https://docs.langchain.com/oss/javascript/langgraph/event-streaming
- LangChain Agent Event Streaming docs: https://docs.langchain.com/oss/javascript/langchain/event-streaming
- LangChain Structured Output docs: https://docs.langchain.com/oss/javascript/langchain/structured-output
- Deep Agents Event Streaming docs: https://docs.langchain.com/oss/javascript/deepagents/event-streaming
- Ecosystem bug: deepagents.js #534 (v3 tool result leaking)
- Ecosystem bug: langchainjs #10937 (ChatModelStream dropping tool_calls)
