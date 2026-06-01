# Fix Cursor Error Classification and Poisoned-Handle Session Persistence

**Date**: June 1, 2026

## Summary

Fixed two bugs in the Cursor execute activity's poisoned-handle recovery path: (1) the error classifier failed to classify resumed-handle errors as `agent-stale` when a stream error classified as `unknown`, preventing recovery from firing; (2) the fresh agentId was never persisted to the session after recovery, causing an infinite loop of recoveries against the same dead handle.

## Problem Statement

When a Cursor agent handle is successfully resumed but fails at runtime (a "poisoned handle"), the runner's error classification and recovery pipeline has two gaps that prevent self-healing.

### Pain Points

- **Silent recovery failure**: A resumed handle that fails with a vague stream error gets classified as `unknown` instead of `agent-stale`, so `shouldRetryWithFreshAgent` returns false and the execution fails permanently — even though a fresh agent would succeed.
- **Infinite recovery loop**: When poisoned-handle recovery does fire, the fresh agentId is not written back to the session because a stale guard condition (`resolution.isNew || !harnessStateId`) always evaluates to false. The next execution resumes the same dead handle, triggering recovery again endlessly.

## Solution

**Bug 1 — Error classifier refactor**: Extracted the priority cascade from `synthesizeError` into a private `classifyFromSources` helper (unchanged logic). The public function now applies a post-classification override: when the best available source classifies as `unknown` and the handle was resumed, the category is upgraded to `agent-stale` with `retryable: true`. Specific diagnoses (auth, rate-limit, network, model) are never overridden.

**Bug 2 — Unconditional session persistence**: Removed the faulty guard condition from the poisoned-handle recovery path. The recovery code now always persists the fresh agentId to the session via `updateSession`, matching the slug-clearing and error-tolerance patterns from Phase 9.

## Implementation Details

### Files Changed

- `backend/services/runner/src/activities/execute-cursor/error-classifier.ts` — Refactored `synthesizeError` into two stages (classify + context override), extracted `SynthesizeErrorOpts` interface, updated module and function JSDoc.
- `backend/services/runner/src/activities/execute-cursor/index.ts` — Removed the `if (resolution.isNew || !blueprint.sessionSpec.harnessStateId)` guard on the poisoned-handle session update (line 760).
- `backend/services/runner/src/activities/__tests__/error-classifier.test.ts` — Extended from 9 to 24 tests covering the bug-fix case, all source branches (SDK, stream, rejection, fallback), the resumed-handle override, source priority ordering, and complete `shouldRetryWithFreshAgent` coverage.

### Design Decisions

- **Extract-and-override over inline fix**: Matches the file's existing pattern (`matchesAny`, `classifyText` are already extracted helpers). The override is a principled statement — "if no source can identify the cause and the handle was resumed, treat it as stale" — rather than a branch-specific patch.
- **Override scoped to `unknown` only**: Specific diagnoses represent real root causes that should not be suppressed. Only `unknown` — meaning no source could identify the error — gets the stale-handle heuristic.
- **Unconditional persistence over corrected conditional**: The `resolution` variable is `const` and reflects the pre-recovery state. Rather than introducing complexity to derive a corrected check, the guard is removed entirely — the poisoned-handle recovery path exists specifically to replace a dead agent, so persisting the replacement should always happen.

## Benefits

- Poisoned-handle recovery now fires correctly when stream errors are unclassifiable on resumed handles.
- Fresh agentId is always persisted after recovery, breaking the infinite recovery loop.
- Comprehensive test coverage (24 tests) for the error classifier prevents regression.
- No behavioral change for non-resumed handles or handles with specific error diagnoses.

## Impact

- **Runner service**: Internal fix, no API or proto changes.
- **End users**: Cursor agent executions that previously failed permanently on stale handles will now self-heal via fresh-agent recovery.
- **Cross-repo**: No changes needed in stigmer-cloud.

## Related Work

- T01: Event sequence continuation (commit `dd1a4e8cb`)
- T02: Task-level resume in TS engine
- T03: Recovery flag propagation (commits `42bce319f`, `39377761`)
- T05: React event store reset on recovery (commit `392ce77d0`)
- T06: Terminate child TS workflow on recovery (commits `ca65a92d9`, `7061f539`)

---

**Status**: Production Ready
**Timeline**: T04 of the workflow execution recovery project (20260601.01)
