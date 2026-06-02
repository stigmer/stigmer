# Phase 2: V3StatusBuilder + Protocol Normalizer

**Date**: May 26, 2026

## Summary

Implemented the v3 event processing stack for the ExecuteDeepAgent streaming pipeline. The V3ProtocolNormalizer translates raw LangGraph v3 ProtocolEvents into a typed StigmerRunEvent discriminated union. The V3StatusBuilder consumes those events and produces the same AgentExecutionStatus proto contract that the Console, SDK, and workflow callbacks depend on. The v3 streaming loop now has full orchestration parity with v2: scheduler-driven persists, STOP/pause/recursion terminal handlers, approval gates, heartbeats with message count + phase, and artifact/writeback side effects via a ToolInputCache.

## Problem Statement

Phase 1 of the v3 streaming migration proved the API works and `run.output.structuredResponse` is accessible. But the v3 path was recording-only — it did not build `AgentExecutionStatus` protos, did not persist status during execution, did not accumulate usage tokens, and had broken artifact publish (v3 `tool-finished` events don't carry input, unlike v2 `on_tool_end`).

### Pain Points

- v3 executions produced empty messages, zero usage tokens, and no `final_text` in the activity return
- No live gRPC status updates during v3 execution — Console/SDK saw no streaming progress
- Artifact publish/writeback triggers were broken because `tool-finished` events lack the tool input with file paths
- Terminal conditions (STOP, pause, recursion limit) were not handled, leaving executions in undefined states
- InlinePublisher and WriteBackCoordinator were coupled to the v2 StatusBuilder class, blocking v3 integration

## Solution

Built a layered v3 event processing stack with clean boundaries between protocol parsing, domain mapping, and orchestration:

1. **ExecutionStatusWriter interface** — decoupled side-effect classes from the v2 StatusBuilder
2. **status-builder-shared.ts** — extracted UsageAccumulator and helpers for both builders
3. **v3-events.ts** — 13-kind StigmerRunEvent discriminated union with documented ID conventions
4. **v3-protocol-normalizer.ts** — stateless normalizer with defensive camelCase/snake_case parsing
5. **v3-status-builder.ts** — proto builder with tool_call_id keying, usage dedup, progressive arg accumulation
6. **streaming-side-effects.ts** — ToolInputCache correlating tool-started input with tool-finished
7. **streaming-terminal.ts** — shared pause/stop/recursion handlers for both v2 and v3
8. **streaming-v3.ts rewrite** — full orchestration parity with v2

## Implementation Details

### Architecture

```
V3ProtocolEvent → V3ProtocolNormalizer → StigmerRunEvent[] → V3StatusBuilder → AgentExecutionStatus
                                                                      ↓
                                                           StreamingUpdateScheduler → persistWithRetry
```

### Key design decisions

- **tool_call_id keying** (not run_id) — v3 tool events use provider tool call IDs, different from v2's LangChain callback run IDs
- **Usage on message_finish only** — v3 emits both standalone `usage` events and `message-finish` with identical payloads; accumulating both would double-count
- **Lazy message creation** — `message_start` records the runId but defers AI message creation to the first `text_delta`, preserving THINKING-before-AI ordering from v2
- **Tool namespace resolution** — strips `tools:*` segments from v3 namespace to find the parent agent's AI message
- **ToolInputCache** — caches tool-started input by callId so tool-finished can trigger artifact publish with correct file paths

### Files created (8)

- `execution-status-writer.ts`, `status-builder-shared.ts`, `v3-events.ts`, `v3-protocol-normalizer.ts`, `v3-status-builder.ts`, `streaming-side-effects.ts`, `streaming-terminal.ts`, `__test-utils__/v3-event-fixtures.ts`

### Files modified (9)

- `status-builder.ts`, `inline-publisher.ts`, `writeback-coordinator.ts`, `index.ts`, `streaming.ts`, `streaming-v3.ts`, plus 3 test files

### Test results

- 824 tests pass (+106 new tests from Phase 2)
- 33 normalizer tests, 17 V3StatusBuilder tests (8 golden sequences), 22 streaming-v3 orchestration tests
- All 8 golden sequences produce identical proto assertions as v2
- Zero v2 regressions; 10 pre-existing failures in index.test.ts unchanged

## Benefits

- v3 streaming path now produces live status updates visible to Console/SDK during execution
- Messages, thinking blocks, tool calls, and usage tokens stream correctly on v3
- Artifact publish and writeback triggers work correctly with ToolInputCache
- Terminal conditions (STOP, pause, recursion) handled identically to v2
- Side-effect classes decoupled from v2 StatusBuilder via interface — ready for v3 integration in index.ts
- Shared terminal handlers eliminate semantic divergence between v2 and v3 paths
- 88 lines of duplicated code removed from status-builder.ts via shared utility extraction

## Impact

- **Console/SDK**: v3 executions will show live streaming progress (messages, tools, usage) once v3 is enabled
- **Runner**: v3 streaming loop is now functionally complete for Phase 3 (structured output rollout)
- **Architecture**: Clean boundary between LangGraph protocol instability and Stigmer domain mapping
- **Testing**: 106 new unit tests providing regression coverage for the v3 event processing stack

## Related Work

- Phase 1: v3 event recorder + hypothesis validation (Sessions 5-6)
- Phase 3 (next): populate `structuredOutput` on status proto before persist, enable v3 for structured output runs
- Checkpoint CP04: v3 hypothesis validation results

---

**Status**: Production Ready (behind `LANGGRAPH_STREAM_EVENTS_VERSION=v3` feature flag)
**Timeline**: 1 session (~2 hours)
