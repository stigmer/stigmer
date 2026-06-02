# Fix Integration Test Timing in Offline Mode

**Date**: May 25, 2026

## Summary

Reduced offline integration test suite wall-clock time by ~8 minutes by eliminating unnecessary LLM proxy timeouts and hardcoded sleeps in `agent_call` workflow tests. Tests that previously waited ~110s each for the proxy to timeout now fail fast in ~5s, while preserving full event pipeline coverage.

## Problem Statement

When running `make test-integration` without `ANTHROPIC_API_KEY` or `CURSOR_API_KEY`, several `agent_call` tests still execute (they don't skip) and pass — they validate event emission, persistence, and session reuse even when the child execution fails. However, they waste ~110s **each** waiting for the Java LLM proxy to timeout.

### Pain Points

- `TestWorkflowAgentCall_IdempotentSessionReuse` took 186s (double proxy timeout: run + recover)
- `TestWorkflowAgentCall_EventsPersistedAndStreamable` took 116s
- `TestWorkflowAgentCall_LiveEventsEmitted` took 111s
- `TestWorkflowAgentCall_ProgressEventsHaveChildExecutionId` took 85s
- Two env-forwarding tests used hardcoded `time.Sleep(20s)` to wait for child execution creation

## Solution

Three-tier fix: remove hardcoded sleeps, skip the worst offender, and add configurable fast-fail timeouts.

## Implementation Details

### 1. Replace `time.Sleep(20s)` with polling (test/integration/workflow_agent_call_env_forwarding_test.go)

Both env-forwarding tests now use `require.Eventually` with 500ms polling interval (up to 30s) instead of a blind 20s sleep. The child AgentExecution typically appears within 1-2s.

### 2. Skip `IdempotentSessionReuse` without API key

Added `requireLLMAvailable(t)` gate. This test's recovery-and-reuse assertion is less meaningful when the initial execution fails due to missing keys — the double proxy timeout (186s) isn't worth the marginal offline coverage.

### 3. Configurable LLM request timeout via `STIGMER_LLM_REQUEST_TIMEOUT_MS`

- **Runner side** (`setup.ts`): Both `buildAnthropicModel` and `buildOpenAIModel` now read `STIGMER_LLM_REQUEST_TIMEOUT_MS` and configure the SDK client with that timeout + `maxRetries: 0`.
- **Harness side** (`unified_runner.go`): When no LLM API keys are detected in the host environment, the harness passes `STIGMER_LLM_REQUEST_TIMEOUT_MS=5000` to the runner process, making LLM calls fail in 5s instead of ~110s.

## Benefits

- Offline test suite runs ~8 minutes faster (530s → ~40s for the affected tests)
- Full event pipeline coverage preserved (LiveEvents, ProgressEvents, EventsPersisted still run)
- No behavioral change when API keys ARE present (timeout env var is not set)
- Env-forwarding tests now react to actual state instead of hoping 20s is enough

## Impact

- Developers running integration tests locally without API keys get significantly faster feedback
- CI pipelines that run the offline subset complete faster
- No production code behavior changes (env var is only set by the test harness)

---

**Status**: Production Ready
