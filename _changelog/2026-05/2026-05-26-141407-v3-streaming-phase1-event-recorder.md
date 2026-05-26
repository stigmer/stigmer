# v3 Streaming Migration Phase 1: Feature-Flagged Event Recorder

**Date**: May 26, 2026

## Summary

Implemented the feature-flagged v3 streaming path (Phase 1 of the v3 streaming migration). When `LANGGRAPH_STREAM_EVENTS_VERSION=v3` is set, the runner calls the v3 `streamEvents` API, iterates raw ProtocolEvents, records them to disk, and extracts the final state via `run.output` — validating the `structuredResponse` hypothesis from the deep research report.

## Problem Statement

The Native path (ExecuteDeepAgent) cannot extract structured output via v2 streaming because `structuredResponse` is an `UntrackedValue` stripped during checkpoint writes. The v3 API's `run.output` is the only documented path to access the final merged state including untracked values. Before building the full V3StatusBuilder (Phase 2), we needed infrastructure to validate the v3 API contract against our locked dependency versions (`@langchain/langgraph@1.3.2`, `deepagents@1.10.2`).

### Pain Points

- Structured output completely unavailable on the Native path (only worked via Cursor harness)
- No way to observe v3 protocol event shapes without production risk
- No validation that `run.output.structuredResponse` actually works with our pinned versions
- Two documented ecosystem bugs in our exact version family create migration risk

## Solution

Feature-flagged v3 streaming path that runs in parallel alongside v2 (which remains the default). The v3 path records raw protocol events for analysis and extracts the final state, enabling offline validation before committing to the full migration.

## Implementation Details

**New files:**
- `streaming-v3.ts` — v3 streaming function with raw protocol loop, independent `setInterval` heartbeat (DD01), caller-owned `AbortController` (DD01), `run.output` extraction with 30s timeout protection, and fire-and-forget artifact publish/writeback on `tool-finished` events
- `v3-event-recorder.ts` — Records raw `ProtocolEvent` envelopes to JSON files, gated by `V3_EVENT_RECORD_DIR`

**Modified files:**
- `streaming.ts` — Version router: delegates to `streamExecutionV3` when `deps.streamVersion === "v3"`, otherwise unchanged v2 path. Added `streamVersion` to `StreamDependencies` and `runOutput` to `StreamResult`
- `setup.ts` — Reads `LANGGRAPH_STREAM_EVENTS_VERSION` env var, exposes as `streamVersion` in `SetupResult`
- `index.ts` — Passes `streamVersion` to streaming deps; extracts `structuredResponse` from `result.runOutput` when v3 provides it

**Key architectural decisions implemented:**
- Two-argument v3 call signature (verified from node_modules `.d.ts` inspection)
- Independent heartbeat timer (not per-event) for v3's legitimate event gaps
- `AbortController` signal passed into v3 options for cancellation
- `run.output` awaited AFTER the loop completes (prevents deadlock)
- Defensive camelCase/snake_case normalization for tool event fields

## Benefits

- Enables offline validation of `run.output.structuredResponse` without production risk
- Records raw v3 protocol events for Phase 2 V3StatusBuilder development
- Establishes the heartbeat and cancellation patterns that Phase 2+ will build on
- Zero production behavior change when env var is unset

## Impact

- Runner service: new v3 streaming path (dev/test only, not user-facing)
- No downstream API or proto changes
- No impact to existing v2 streaming behavior
- Unblocks Phase 2 (V3StatusBuilder) and Phase 3 (structured output extraction)

## Related Work

- Phase 0 (Session 3-4): Golden sequence tests, v2 event recorder, artifact/writeback fixes
- Deep research report: `_projects/2026-05/20260525.01.v3-streaming-migration/research.v3-streaming-api-migration/04.report.gpt.md`
- Design decision: `DD01_v3-migration-architecture.md`

---

**Status**: ✅ Production Ready (feature-flagged, off by default)
**Timeline**: 1 session (Session 5)
