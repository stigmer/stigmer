# Summarization Middleware Verification — DeepAgents JS Built-in Confirmed

**Date**: May 19, 2026

## Summary

Verified that the DeepAgents JS built-in `SummarizationMiddleware` already handles context window management correctly for the unified TypeScript runner. No custom summarization implementation is needed — the library's default behavior is model-profile-aware, production-grade, and integrates cleanly with Stigmer's proxy-based token capture and checkpoint persistence infrastructure.

## Problem Statement

The unified runner migration (Phase 4) deferred summarization middleware verification from Phase 3c. The original gate decision (DD-003) flagged "Summarization policy parity" as a MEDIUM risk, noting that DeepAgents JS has built-in summarization but the Python agent-runner might have custom policies that need porting.

### Pain Points

- Unclear whether the Python agent-runner had custom summarization logic that needed porting
- Unknown whether the DeepAgents JS built-in summarization integrates correctly with Stigmer's `HttpCheckpointSaver` (proxy-based MongoDB persistence)
- Concern about potential cost-reporting gaps if the summarization LLM call bypassed the token capture pipeline
- No documentation on how summarization interacts with Stigmer's custom middleware stack (cost-cap, execution-budget, approval-gate)

## Solution

Conducted a thorough verification of the built-in `SummarizationMiddleware` across three dimensions: default threshold behavior, checkpoint serialization compatibility, and middleware stack integration. Created DD-004 documenting the decision to use the built-in implementation as-is.

## Implementation Details

### Key Findings

1. **No Python parity gap**: The Python agent-runner has zero summarization code — no `summarize`, `trim`, `condense`, or context-window management anywhere in `agent-runner/` or `graphton/`. Whatever summarization existed in production came entirely from the DeepAgents Python library's built-in behavior.

2. **Already active**: `createDeepAgent` automatically includes `createSummarizationMiddleware({ backend })` in its default middleware stack. The runner's `setup.ts` has been getting summarization for free since Phase 3a.

3. **Model-profile-aware defaults**: `computeSummarizationDefaults` reads `maxInputTokens` from the model's profile and returns fraction-based thresholds (85% trigger, 10% keep) for profiled models like Claude Sonnet 4 and Opus 4 (200K context → trigger at 170K tokens, keep 20K tokens worth of recent messages).

4. **No cost gap**: The summarization LLM call uses the same `ChatAnthropic` model instance from `setup.ts` with `baseURL` pointing to the Stigmer proxy. All LLM calls — including summarization — route through the proxy, which captures token usage at the HTTP transport level.

5. **Correct middleware ordering**: `createDeepAgent` places summarization before Stigmer's custom middleware (`customMiddleware`), so cost-cap sees the reduced (summarized) message set, not the full unsummarized history.

6. **Checkpoint serialization works**: The `_summarizationEvent` state (including `HumanMessage` objects with `lc_source: "summarization"` metadata) roundtrips correctly through `JsonPlusSerializer` → `$binary` format used by `HttpCheckpointSaver`.

### Files Created

- `backend/services/runner/src/activities/execute-deep-agent/__tests__/summarization-verification.test.ts` — 15 verification tests
- `_projects/.../design-decisions/004-summarization-middleware.md` — Design decision document

## Benefits

- **Zero custom code needed**: Eliminated ~500 lines of potential custom summarization logic that would need ongoing maintenance
- **Production-grade edge cases handled**: Safe cutoff points (never orphans tool results), emergency summarization on `ContextOverflowError`, progressive token estimation calibration, tool result compaction
- **Confidence in long-running executions**: Agents can run indefinitely without hitting context window limits — the middleware compresses history transparently

## Impact

- Unified runner: Summarization verified as production-ready
- Test suite: 417 → 432 tests (15 new verification tests)
- Phase 4 progress: Summarization middleware marked as VERIFIED alongside 3 activities + 2 workflows already ported

## Related Work

- DD-003: Gate decision that identified summarization parity as a risk
- DD-004: Formal design decision documenting the verification outcome
- Phase 3c: Where summarization was originally deferred from

---

**Status**: ✅ Production Ready
**Timeline**: Single session verification
