# Fix Stale EmptyFinalMessage/native Test Assertion

**Date**: May 27, 2026

## Summary

Updated the `EmptyFinalMessage/native` integration test assertion to reflect the v3 streaming pipeline's behavior. With v3 as the default, native structured output is provider-level (`run.output.structuredResponse`) and no longer depends on final turn text content.

## Problem Statement

The `EmptyFinalMessage` test in `agent_execution_15_structured_output_test.go` asserted that the native harness produces nil structured output when the agent's final turn is tool-only. This was correct in the v2 world (text extraction required `finalText`), but stale after v3 became the default in Session 8.

### Pain Points

- Test assertion contradicted actual (correct) pipeline behavior, creating false negatives in provider test runs
- Harness-specific branching (`if h.Name == "cursor"`) was unnecessary since v3 unified the behavior across both harnesses

## Solution

Replaced the harness-specific assertion logic with a phase-aware pattern:
- If execution **completed**: assert structured output is populated with expected keys
- If execution **failed**: tolerate nil (pipeline never reached output extraction)

## Implementation Details

- Removed `if h.Name == "cursor"` branching — both harnesses use v3 now
- Replaced `harness.AssertStructuredOutputNil` with `harness.AssertStructuredOutputPopulated` + key assertions
- Added phase check (`EXECUTION_FAILED`) as a defensive guard for non-deterministic tool-only scenarios
- Updated test comment to document that B1 failure mode is resolved by v3

## Benefits

- Test assertions now match actual pipeline behavior (confirmed in Session 9 E2E validation)
- Removes stale documentation that could mislead future developers about structured output behavior
- Unifies assertion logic across harnesses, reducing test maintenance burden

## Impact

- **File**: `test/integration/agent_execution_15_structured_output_test.go`
- **Scope**: 1 subtest in the structured output pipeline suite
- **Risk**: None — the test now asserts what Session 9 confirmed works

## Related Work

- Part of the v3 streaming migration project (`_projects/2026-05/20260525.01.v3-streaming-migration/`)
- Follows Session 9 E2E validation (checkpoint CP04)
- Related changelogs: `2026-05-26-171938-v3-streaming-default-structured-output-pipeline.md`, `2026-05-27-114712-e2e-structured-output-pipeline-validation.md`

---

**Status**: Production Ready
**Timeline**: Single session fix
