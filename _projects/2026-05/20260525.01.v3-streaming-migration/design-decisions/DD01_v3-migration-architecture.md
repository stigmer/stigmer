# DD01: v3 Migration Architecture

**Date**: 2026-05-26
**Status**: Accepted
**Source**: Deep Research Report (`research.v3-streaming-api-migration/04.report.gpt.md`)

## Context

Migrating from LangGraph streamEvents v2 (callback events) to v3 (protocol events + typed projections). The deep research report was submitted to ChatGPT Deep Research and returned a comprehensive analysis of the v3 API surface, migration patterns, ecosystem risks, and new capabilities.

## Decisions

### 1. Raw Protocol Loop is Canonical

**Decision**: Use a single `for await (const event of run)` loop over raw `ProtocolEvent`s as the authoritative event source. Do NOT consume multiple typed projections concurrently as the primary ingestion path.

**Rationale**: Stigmer centralizes scheduling, heartbeats, cancellation checks, approval gates, artifact publishing, and writeback triggers in one stream-processing loop. Raw protocol events preserve exact `seq` ordering, namespace attribution, and interleaving across coordinator/subagent boundaries. Deep Agents docs explicitly state that when exact arrival order matters, iterate raw protocol events and use `namespace`.

### 2. Feature-Flagged Rollout with v2 Fallback

**Decision**: Introduce `LANGGRAPH_STREAM_EVENTS_VERSION=v2|v3` environment variable. Start v3 for structured-output runs only. Preserve v2 as fallback.

**Rationale**: Two ecosystem bugs in our exact version family (#534, #10937) affect tool orchestration. v2 has no deprecation date. Feature-flagged rollout limits blast radius while delivering the highest-value fix (structured output) first.

### 3. New V3StatusBuilder, Not Adapter on v2

**Decision**: Create a new `V3StatusBuilder` class that consumes `StigmerRunEvent` (a normalized discriminated union). Do not retrofit the existing v2 `StatusBuilder`.

**Rationale**: v3 protocol events have fundamentally different shapes (content-block-centric messages, explicit tool lifecycle, lifecycle channel). An adapter layer would add complexity without reducing risk. The v2 `StatusBuilder` remains intact for the v2 fallback path.

### 4. Independent Heartbeat Timer

**Decision**: Move Temporal heartbeat from per-event to `setInterval(2000)`. Stream events only refresh a `lastActivityAt` timestamp.

**Rationale**: v3 has legitimate event gaps: `nostream` suppresses tokens during internal structured-output generation, long-running Promise tools emit only start/end, and subagent activity may not surface at the parent level. Per-event heartbeat would make Temporal workers appear unhealthy during normal v3 operation.

### 5. Caller-Owned AbortController for Cancellation

**Decision**: Create an `AbortController`, pass its `signal` into v3 options. Abort that controller for cancellation/STOP. Use `run.abort()` as secondary signal only.

**Rationale**: Source inspection of `@langchain/langgraph@1.3.2` shows `stream()` combines the caller's `options.signal` into graph execution config. `GraphRunStream.abort()` alone is not sufficient to cancel the underlying graph execution.

### 6. Structured Output First

**Decision**: Phase 3 enables v3 only when `responseFormat` is present. This is the first user-visible v3 feature.

**Rationale**: Structured output is the production blocker. It has the highest value (unblocks schema-based APIs) and narrowest scope (only runs with `responseFormat`). v2 fundamentally cannot extract `structuredResponse` because it's an `UntrackedValue` invisible to callbacks and checkpoints.

### 7. StigmerRunEvent Normalization Layer

**Decision**: Introduce a `V3ProtocolNormalizer` that converts raw `ProtocolEvent` into a `StigmerRunEvent` discriminated union type, with defensive field normalization for camelCase/snake_case inconsistencies.

**Rationale**: The agent-protocol spec uses camelCase (`toolCallId`, `toolName`) but some JS code emits snake_case (`tool_call_id`, `tool_name`). A normalization layer isolates the StatusBuilder from protocol instability and provides a clean contract for testing.

## Rejected Alternatives

- **Multiple concurrent projection consumers**: Rejected because ordering across projections is not guaranteed, and Stigmer's architecture depends on single-stream ordering for heartbeats, approval gates, and writeback triggers.
- **Adapter on v2 StatusBuilder**: Rejected because v3 event shapes are fundamentally different and an adapter adds complexity without reducing risk.
- **Big-bang migration (no feature flag)**: Rejected due to known ecosystem bugs in our version family.
- **Depending on `run.updates` as built-in**: Rejected because `run.updates` does not exist on base `GraphRunStream` in @langchain/langgraph@1.3.2.
