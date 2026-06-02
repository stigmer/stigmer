# Fix agent_call Integration Test LLM Prerequisite Gate

**Date**: May 24, 2026

## Summary

Added missing `ANTHROPIC_API_KEY` prerequisite checks to workflow `agent_call`
integration tests that require a real LLM to complete. Without the gate, these
tests ran for ~110 seconds each before failing with `EXECUTION_FAILED`, and the
sandbox colocation test cascaded into a ~920-second suite timeout with goroutine
panic detection.

## Problem Statement

Four workflow `agent_call` integration tests consistently failed:

- `TestWorkflowAgentCall_SimpleExecution` (112.53s — EXECUTION_FAILED)
- `TestWorkflowAgentCall_StructuredOutput` (106.38s — EXECUTION_FAILED)
- `TestSession_SubjectGeneration_WorkflowCallAgent` (114.76s — EXECUTION_FAILED)
- `TestSandboxColocation_SessionRunnerID` (~920s — timeout, goroutine dump)

### Pain Points

- Each failing test consumed ~110s before failing, wasting CI time
- The sandbox colocation test's cascading timeout caused goroutine dumps that
  aborted rerun logic for the entire suite
- Error message (`execution reached terminal phase EXECUTION_FAILED`) gave no
  indication that the root cause was a missing API key
- Two other agent_call tests appeared to pass but were silently tolerating the
  same child execution failure (they only checked for events, not completion)

## Solution

The root cause was a **prerequisite asymmetry**: direct agent execution tests
use `harness.RequireNativePrereqs` which skips when `ANTHROPIC_API_KEY` is
absent, but the workflow `agent_call` tests had their own `requireAgentCallPrereqs`
function that only checked for the unified runner — not the API key.

All `agent_call` child executions use `HARNESS_NATIVE` by default, which routes
through the Java service's LLM proxy to Anthropic. Without an upstream API key,
the proxy request hangs until timeout, the child execution fails, and the parent
workflow propagates `EXECUTION_FAILED`.

Added `ANTHROPIC_API_KEY` checks to the four failing tests so they skip cleanly
when the key is not available. Tests that don't require LLM completion (event
verification, failure propagation, nonexistent agent) are unaffected.

## Implementation Details

| File | Change |
|------|--------|
| `test/integration/workflow_agent_call_test.go` | Added `requireLLMAvailable()` helper; called from `SimpleExecution` and `StructuredOutput` |
| `test/integration/session_subject_generation_test.go` | Added inline `ANTHROPIC_API_KEY` check to `WorkflowCallAgent` test |
| `test/integration/workflow_sandbox_colocation_test.go` | Added inline `ANTHROPIC_API_KEY` check; updated comment to reflect actual prerequisites |

## Benefits

- Suite completes in ~560s instead of ~920s (no cascading timeout)
- Clear skip messages explain why tests are not running
- No goroutine dump / panic detection from stuck child executions
- Consistent with the established `RequireNativePrereqs` pattern used by all
  other native harness tests

## Impact

- All workflow `agent_call` tests that assert `EXECUTION_COMPLETED`
- No impact on event-only tests, failure-scenario tests, or offline test suite
- Tests will run and pass when `ANTHROPIC_API_KEY` is provided

---

**Status**: Production Ready
