# V3 Streaming Hypothesis Validated: `run.output.structuredResponse` Confirmed

**Date**: May 26, 2026

## Summary

Validated the core thesis of the v3 streaming migration: `run.output.structuredResponse` is accessible on real deepagents runs via the v3 `streamEvents` API. With a real Anthropic LLM (`claude-sonnet-4-20250514`), every structured output execution (7/7) produced `structuredResponse=true` in `run.output`. This confirms Phase 2 can proceed as designed.

## Problem Statement

The v3 streaming path (Phase 1) was implemented and unit-tested with mocked `streamEvents`, but the hypothesis that `run.output` contains `structuredResponse` (an `UntrackedValue` invisible to v2's checkpoint-backed `getState()`) had never been validated on a real graph execution against our exact dependency versions (`@langchain/langgraph@1.3.2`, `deepagents@1.10.2`).

### Pain Points

- Deep research report confirmed the thesis on source-level analysis, but not on our exact version family
- All 19 streaming-v3 unit tests used mocked `streamEvents` — zero integration coverage
- Two known ecosystem bugs (#534, #10937) in our version family created uncertainty
- Runner `dist/` build could be stale, silently running v2 instead of v3

## Solution

Ran the full offline integration test suite and targeted provider integration tests with `LANGGRAPH_STREAM_EVENTS_VERSION=v3` + `V3_EVENT_RECORD_DIR` to exercise the real LangGraph/deepagents v3 protocol stack.

## Implementation Details

**Validation approach**: Environment variable injection via the test harness's `buildUnifiedRunnerEnv()`, which inherits `os.Environ()`. No code changes needed — the Phase 1 feature flag and recording infrastructure were already wired.

**Key discovery**: Initial test run used stale `dist/main.js` (pre-v3 build). Runner log showed `[streaming] ... 48 events` (v2 tag) instead of `[streaming-v3]`. Rebuilt runner (`npm run build`) and re-ran.

**Mock LLM results** (offline suite, 46 tests):
- 36 passed, 9 failed (expected Phase 1 gaps), 1 skipped
- V3 streaming worked: 73 protocol events, lifecycle `started → running → completed`
- `run.output` resolved with keys `[messages, jumpTo, todos, files, ...]`
- `structuredResponse` absent — expected: mock LLM doesn't implement `responseFormat`

**Real Anthropic LLM results** (provider suite):
- `run.output` resolved with `structuredResponse=true` on all 7 executions
- Runner successfully extracted it: `"Structured output extracted from v3 run.output"`

**Pipeline gap identified**: `structuredResponse` is extracted in `index.ts` but only placed in `slim.structured` (Temporal activity return). It is NOT set on `initialStatus.structuredOutput` before `persistStatus()`. Fix: ~3 lines in Phase 3.

**Event shape correction**: Event type is at `data.event` (not `data.type` as research report suggested). Normalization detail for Phase 2's `V3ProtocolNormalizer`.

## Benefits

- **Go/no-go gate cleared**: Phase 2 can proceed with confidence that `structuredResponse` is the reliable native source for structured output
- **V3 event corpus captured**: 9 recordings (~12MB) serve as development reference for `V3StatusBuilder`
- **Pipeline gap mapped**: Precise fix identified (3 lines) for Phase 3
- **Event shape documented**: `data.event` field name corrected from research report, preventing Phase 2 implementation errors

## Impact

- **v3 streaming migration**: Unblocked for Phase 2 (`V3StatusBuilder` + `V3ProtocolNormalizer`)
- **Structured output pipeline**: Root cause of native-path structured output failures now fully understood — it's an `UntrackedValue` invisible to v2, but present in v3 `run.output`
- **Test infrastructure**: Stale-build risk documented; future sessions must rebuild runner before integration tests

## Related Work

- Phase 1 implementation: `_changelog/2026-05/2026-05-26-141407-v3-streaming-phase1-event-recorder.md`
- Deep research report: `_projects/2026-05/20260525.01.v3-streaming-migration/research.v3-streaming-api-migration/04.report.gpt.md`
- Previous structured output investigation: `_changelog/2026-05/2026-05-26-121306-fix-structured-output-extraction-pipeline-v3.md`

---

**Status**: Validated
**Timeline**: 1 session (~45 min)
