# Checkpoint CP03: Phase 1 — v3 Event Recorder

**Date**: 2026-05-26
**Session**: 5
**Status**: COMPLETE

## What Was Done

### 1. Feature-Flagged v3 Streaming Path

**Implementation**: `streaming-v3.ts` — `streamExecutionV3()` function

Key properties:
- Two-argument v3 call: `await agentGraph.streamEvents(input, { ...config, version: "v3", signal })`
- Independent heartbeat via `setInterval(2000)` (not per-event)
- Caller-owned `AbortController` created internally, signal passed to v3 options
- `run.output` extracted after stream completes with 30s timeout protection
- Artifact publish/writeback on `tool-finished` events (defensive field normalization)
- Pre-loop heartbeat call to cover the initial `await` gap

### 2. v3 Event Recorder

**Implementation**: `v3-event-recorder.ts`

- Gated by `V3_EVENT_RECORD_DIR` env var (zero overhead when off)
- Records `ProtocolEvent` shape: seq, method, namespace, timestamp, node, data
- Output: `{executionId}.v3-events.json`
- Same safe-clone pattern as v2 recorder (bigint, circular ref handling)

### 3. Version Routing in `streaming.ts`

- `streamExecution()` routes based on `deps.streamVersion`
- v2 path moved to `streamExecutionV2` (same file, unexported)
- Zero changes to v2 logic

### 4. Interface Extensions

- `StreamDependencies` gained `streamVersion?: "v2" | "v3"`
- `StreamResult` gained `runOutput?: Record<string, unknown>`
- `SetupResult` gained `streamVersion: "v2" | "v3"`

### 5. `setup.ts` — Env Var Resolution

- Reads `LANGGRAPH_STREAM_EVENTS_VERSION` (defaults to "v2")
- Logged in setup completion message

### 6. `index.ts` — Structured Output Extraction

- Passes `streamVersion` to `StreamDependencies`
- After post-stream: checks `result.runOutput?.structuredResponse`
- Replaces the v2-era "not available" log with conditional extraction

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| `streaming-v3.test.ts` | 19 | All pass |
| `v3-event-recorder.test.ts` | 10 | All pass |
| `streaming.test.ts` (with routing) | 21 | All pass |
| All `execute-deep-agent/__tests__/` (excl. pre-existing index.test.ts failures) | 358 | All pass |

## Files Changed

### New
- `backend/services/runner/src/activities/execute-deep-agent/streaming-v3.ts`
- `backend/services/runner/src/activities/execute-deep-agent/v3-event-recorder.ts`
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/streaming-v3.test.ts`
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/v3-event-recorder.test.ts`

### Modified
- `backend/services/runner/src/activities/execute-deep-agent/streaming.ts`
- `backend/services/runner/src/activities/execute-deep-agent/setup.ts`
- `backend/services/runner/src/activities/execute-deep-agent/index.ts`
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/streaming.test.ts`

## Verified Type Contracts

Inspected actual `.d.ts` files in `backend/services/runner/node_modules/`:
- `@langchain/langgraph@1.3.2`: `GraphRunStream`, `ProtocolEvent`, `StreamEventsV3Options`
- `deepagents@1.10.2`: `DeepAgentRunStream`, v3 `streamEvents` overload
- Confirmed: two-arg signature, `Promise<GraphRunStream>` return, `signal` in options

## Next Steps

1. **Validate hypothesis**: Run offline tests with `LANGGRAPH_STREAM_EVENTS_VERSION=v3` + `V3_EVENT_RECORD_DIR` to capture real v3 events and confirm `run.output.structuredResponse`
2. **Phase 2**: Build `V3StatusBuilder` + `V3ProtocolNormalizer` using recorded events as reference
3. **Phase 3**: Enable v3 for structured output runs (first user-visible v3 feature)
