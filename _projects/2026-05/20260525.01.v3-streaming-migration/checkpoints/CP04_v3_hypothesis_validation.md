# Checkpoint CP04: v3 Hypothesis Validation

**Date**: 2026-05-26
**Session**: 6
**Status**: COMPLETE — Hypothesis CONFIRMED

## Summary

Validated that `run.output.structuredResponse` is accessible on real deepagents runs with the v3 streamEvents API. The hypothesis from the deep research report is confirmed: v3 `run.output` includes `structuredResponse` (an `UntrackedValue`) when a real LLM provider (Anthropic) is used with `responseFormat` configured.

## What Was Validated

### 1. V3 Streaming Works End-to-End

- v3 `streamEvents` call succeeds with both mock LLM and real Anthropic
- 73–2191 raw ProtocolEvents per execution (depending on response length)
- Event channels confirmed: `lifecycle`, `messages`, `tasks`, `updates`, `values`, `checkpoints`
- Lifecycle: `started` → `running` → `completed`
- Messages: `message-start`, `content-block-start`, `content-block-delta`, `content-block-finish`, `message-finish`, `provider`, `usage`
- `run.output` resolves within the 30s timeout

### 2. `structuredResponse` in `run.output` — CONFIRMED

With real Anthropic LLM (`claude-sonnet-4-20250514`):
```
run.output resolved. Keys: [messages, jumpTo, todos, files,
  _summarizationSessionId, _summarizationEvent, structuredResponse].
  hasStructuredResponse=true
```

Every structured output execution (7/7) produced `structuredResponse=true` in `run.output`.

### 3. `structuredResponse` Absent with Mock LLM — EXPECTED

With mock LLM (Anthropic SSE format without native structured output support):
```
run.output resolved. Keys: [messages, jumpTo, todos, files,
  _summarizationSessionId, _summarizationEvent].
  hasStructuredResponse=false
```

The mock LLM doesn't implement `responseFormat`, so deepagents' `ReactAgent` never populates `structuredResponse`. This is expected — `structuredResponse` requires provider-native structured output support.

### 4. Pipeline Gap Identified

The runner extracts `structuredResponse` from `run.output` correctly (line 202-204 of `index.ts`), but it only places the value in `slim.structured` (the Temporal activity return value). It does NOT set `initialStatus.structuredOutput` before calling `persistStatus()`.

The consequence: the Java service's `UpdateStatus` handler never sees `structuredOutput` on the persisted status, so `AgentExecution.status.structuredOutput` remains nil when queried via gRPC. The Go orchestrator's `buildCallbackResult` does correctly extract `slim.structured` for workflow callback results, but standalone agent execution queries still see nil.

**Fix**: Set `initialStatus.structuredOutput` from extracted `structuredResponse` before `persistStatus()` call. This is a ~3-line change in `index.ts`.

## Test Results

### Offline Tests (Mock LLM, v3 enabled)

After rebuilding the runner (initial run used stale dist):

| Category | Pass | Fail | Notes |
|----------|------|------|-------|
| Plain chat, thinking | 2 | 0 | V3 streaming works for basic text |
| HITL (approve, skip, reject, auto) | 5 | 0 | Approval flow works with v3 |
| Lifecycle (cancel, terminate, pause) | 7 | 0 | Lifecycle management works with v3 |
| MCP tools | 3 | 0 | Tool execution works with v3 |
| LLM call (workflow) | 3 | 0 | Workflow tasks work with v3 |
| Workflow architect | 4 | 0 | Complex agent flows work with v3 |
| Structured output (assertions on non-nil) | 0 | 5 | Expected: mock LLM → no structuredResponse; Phase 1 → no StatusBuilder → no final_text → no server-side extraction |
| Structured output (nil-tolerant) | 5 | 0 | Tests that tolerate nil structuredOutput pass |
| Eval | 0 | 2 | Workflow eval tasks fail (separate issue) |
| Subagent | 0 | 1 | Incomplete tool result (Phase 1 gap: no StatusBuilder) |
| Task IO tokens | 0 | 1 | input_tokens=0 (Phase 1 gap: no usage accumulation) |

### Provider Tests (Real Anthropic, v3 enabled)

| Test | Status | Runner Log |
|------|--------|------------|
| PureJsonResponse | FAIL (nil SO) | `hasStructuredResponse=true`, extracted from run.output |
| MarkdownProse | FAIL (nil SO) | `hasStructuredResponse=true`, extracted from run.output |
| CodeFencedJson | FAIL (nil SO) | `hasStructuredResponse=true`, extracted from run.output |
| MultiTurnVerbose | FAIL (nil SO) | `hasStructuredResponse=true`, extracted from run.output |
| NestedSchema | FAIL (nil SO) | `hasStructuredResponse=true`, extracted from run.output |
| SchemaWithNullableField | FAIL (nil SO) | `hasStructuredResponse=true`, extracted from run.output |

All failures are due to the pipeline gap (structuredOutput not set on status proto before persist), NOT due to `structuredResponse` being absent. The runner successfully extracts it from `run.output` in every case.

## V3 Event Shapes (from recorded events)

Event field mapping differs from deep research report expectations:

| Expected (from report) | Actual (v3 protocol) |
|------------------------|---------------------|
| `data.type = "message-start"` | `data.event = "message-start"` |
| `data.type = "content-block-delta"` | `data.event = "content-block-delta"` |
| `data.type = "tool-started"` | `data.event = "tool-started"` |
| Event type at `data.type` | Event type at `data.event` |

This is a minor normalization detail for the `V3ProtocolNormalizer` in Phase 2.

## V3 Event Files

Recorded to `/tmp/stigmer-v3-provider/`:
- 9 execution recordings, 99KB–9.7MB
- Total: ~12MB of v3 protocol event data
- Covers: plain text, structured output (multiple schemas), markdown prose, code-fenced JSON, multi-turn, nested schemas

These files serve as development reference for Phase 2's `V3StatusBuilder`.

## Decisions

1. **Proceed to Phase 2** — the v3 hypothesis is confirmed. `run.output.structuredResponse` is the reliable source for structured output.
2. **Pipeline fix** — set `initialStatus.structuredOutput` before `persistStatus()` as part of Phase 3 (structured output first user-visible feature).
3. **Mock LLM enhancement** — not needed for Phase 2. The mock works for event shape validation. Provider tests validate the structured output path.
4. **Event field normalization** — `data.event` (not `data.type`) is the actual field name. Update Phase 2 normalizer accordingly.

## Next Steps

1. **Phase 2**: Build `StigmerRunEvent` discriminated union, `V3ProtocolNormalizer` (using `data.event`), and `V3StatusBuilder`
2. **Phase 3**: Fix pipeline gap (structuredOutput on status proto) + enable v3 for structured output runs
