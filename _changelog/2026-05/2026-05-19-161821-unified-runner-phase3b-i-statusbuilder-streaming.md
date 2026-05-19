# Unified Runner Phase 3b-i: StatusBuilder + GrpcRetryExecutor + Streaming Loop

**Date**: May 19, 2026

## Summary

Replaced the Phase 3a `invoke()` + final-message-extract approach in ExecuteDeepAgent with production-grade streaming: `streamEvents()` v2 consumption, real-time LangGraph event-to-proto mapping via a StatusBuilder, hybrid time+event throttled persistence, exponential-backoff gRPC retry, and STOP signal handling. This is the foundational streaming infrastructure that the middleware stack (3b-ii), artifact/writeback handling (3b-iii), and HITL (3c) plug into.

## Problem Statement

Phase 3a delivered a walking skeleton where `ExecuteDeepAgent` used LangGraph's `invoke()` to run the agent and then extracted only the final assistant message. This had several limitations:

### Pain Points

- No progressive status updates — the UI showed nothing until the entire execution completed
- No tool call visibility — tool starts/completions were invisible to the frontend
- No usage tracking — token consumption was not captured
- No thinking block visibility — Anthropic's extended thinking was lost
- No STOP signal handling — platform control signals from `updateStatus()` were ignored
- No retry on transient gRPC failures — a single network hiccup lost the status update
- No stall detection — a hung LLM or tool would block indefinitely

## Solution

Six new modules + one modified file that together form the streaming pipeline:

1. **ExecutionState** — mutable state model holding the proto and O(1) indexes
2. **StreamingUpdateScheduler** — hybrid time+event scheduler (500ms min / 50-burst / 5s keepalive)
3. **GrpcRetryExecutor** — exponential-backoff retry with gRPC error classification
4. **StatusBuilder** — LangGraph event-to-proto mapper for 4 event types + thinking blocks + usage
5. **Streaming loop** — `streamEvents()` consumption with scheduler, retry, STOP, stall detection, heartbeat
6. **Index wiring** — replaced `executeAgent()` with `streamExecution()`

## Implementation Details

### New Files

| File | Purpose | Lines |
|------|---------|-------|
| `execution-state.ts` | Mutable state: proto + toolCalls Map + messagesByRun + currentAiMessage + lastLlmRunId + toolStartTimes | ~90 |
| `streaming-scheduler.ts` | Hybrid time+event scheduler with env-configurable thresholds | ~160 |
| `grpc-retry.ts` (shared) | `persistWithRetry()` with 100ms→800ms backoff, UNAVAILABLE/DEADLINE_EXCEEDED retry, NOT_FOUND/INVALID_ARGUMENT/PERMISSION_DENIED terminal | ~110 |
| `status-builder.ts` | `processEvent()` dispatcher with Map-based routing, handlers for `on_chat_model_stream`, `on_chat_model_end`, `on_tool_start`, `on_tool_end`, thinking blocks, usage accumulation | ~270 |
| `streaming.ts` | `streamExecution()` consuming `streamEvents()` v2, terminal handlers for STOP/pause/recursion-limit/stall | ~230 |

### Modified Files

| File | Change |
|------|--------|
| `index.ts` | Replaced `executeAgent()` + `buildFinalStatus()` + `extractContent()` with `streamExecution()` call. Removed ~80 lines of Phase 3a code, added ~20 lines of streaming wiring. |

### Key Design Decisions

- **Map-based event dispatch** (O(1)) instead of if/else chain
- **Object reference sharing** between indexes and proto repeated fields — mutations propagate automatically
- **Hybrid persistence cadence** ported from Python's battle-tested `StreamingUpdateScheduler`
- **Non-throwing retry** — `persistWithRetry()` never crashes the streaming loop; falls back to UNSPECIFIED on permanent failure
- **Stall detection via monotonic timer** — Node.js-appropriate replacement for Python's `asyncio.timeout`
- **Phase-scoped**: no sub-agent routing, no HITL, no middleware — clean extension points for 3b-ii/3c

### Test Coverage

| Test File | Tests | Focus |
|-----------|-------|-------|
| `execution-state.test.ts` | 9 | Reference sharing, index rebuild, reset behavior |
| `streaming-scheduler.test.ts` | 20 | Time threshold, burst, keepalive, env config, priority |
| `grpc-retry.test.ts` | 15 | Retry/terminal classification, backoff timing, exhaustion |
| `status-builder.test.ts` | 26 | Event mapping table, turn boundaries, thinking, usage accumulation |
| `streaming.test.ts` | 9 | Happy path, STOP signal, cancellation, recursion limit, zero events |

**Total**: 79 new tests, 169 total (zero regressions).

## Benefits

- **Real-time UI**: Progressive status updates stream to the frontend as the agent works
- **Tool visibility**: Every tool start/complete/fail is reflected in the status proto
- **Usage tracking**: Token consumption accumulates across turns into `RunnerUsageSummary`
- **Platform control**: STOP signals are respected immediately
- **Resilience**: Transient gRPC failures are retried with backoff
- **Safety**: Stall detection and recursion limits prevent indefinite hangs
- **Testability**: 79 new unit tests with injectable clocks and mock async iterables

## Impact

- **ExecuteDeepAgent** now has streaming parity with the Python `agent-runner`'s core event loop
- The Python `agent-runner` still handles `ExecuteGraphton` on the base queue until validated cutover
- Phases 3b-ii (middleware), 3b-iii (artifacts/writeback), and 3c (HITL) can now plug into the established streaming pipeline

## Related Work

- Phase 3a checkpoint: `_projects/2026-05/20260518.01.unified-runner-migration/checkpoints/2026-05-19-session-4-phase3a.md`
- Phase 3b plan: `_projects/2026-05/20260518.01.unified-runner-migration/tasks/T03b_0_plan.md`
- Gate decision: `_projects/2026-05/20260518.01.unified-runner-migration/design-decisions/003-t01-gate-decision.md`

---

**Status**: ✅ Production Ready (for Phase 3b-i scope)
**Timeline**: 1 session (~2 hours)
