# Interactive E2E Tests for Critical User Flows

**Date**: May 21, 2026

## Summary

Added 9 new Playwright interactive E2E tests covering the two primary user journeys: workflow execution via Run button (5 offline tests) and agent execution via session (4 LLM-gated canary tests). Built on the interactive infrastructure committed earlier today, with architecturally sound timing strategies grounded in deep analysis of the workflow engine's cooperative pause mechanism.

## Problem Statement

The existing interactive E2E tests (3 specs, 8 tests) proved the infrastructure works but didn't test the actual user entry points: clicking "Run" on a workflow and sending a message to start an agent execution. These are the two critical flows that every Stigmer user interacts with.

### Pain Points

- No test verifies the Run button → dialog → execution navigation path
- No test verifies workflow pause/resume/cancel works from the UI
- No test verifies the session composer state machine (disabled during execution, enabled after)
- No test verifies multi-turn conversation (follow-up messages)
- Existing tests seed data via API, bypassing the UI entry point entirely

## Solution

Two new spec files with domain-scoped interaction helpers, using architecturally sound timing strategies:

- **Workflow tests**: Use a `wait` task (10s Temporal timer) to create a stable IN_PROGRESS window for pause/cancel testing — avoiding the inherently flaky approach of racing Playwright clicks against ~50ms set_vars task boundaries.
- **Session tests**: Assert on structural elements (phase badges, composer disabled state) rather than LLM content, with generous timeouts.

## Implementation Details

### New files (3)
- `test/e2e/helpers/workflow-detail.ts` — 4 helpers for workflow detail navigation and Run dialog interaction
- `test/e2e/tests/interactive/workflow-run-flow.spec.ts` — 5 tests (offline, no LLM)
- `test/e2e/tests/interactive/session-execution-flow.spec.ts` — 4 tests (LLM-gated canary)

### Modified files (4)
- `test/e2e/fixtures/seed-helpers.ts` — added `createTestWaitWorkflow` (wait task + set_vars)
- `test/e2e/fixtures/index.ts` — wired `testWaitWorkflow` fixture with auto-cleanup
- `test/e2e/helpers/workflow-execution.ts` — added `clickPause`, `clickResume`, `clickCancel`, `waitForPhaseTransition`
- `test/e2e/helpers/session.ts` — added `getExecutionProgressRegion`, `waitForExecutionPhase`, `assertComposerEnabled/Disabled`

### Key architectural decisions
- **Wait task for pause/cancel**: `set_vars` completes in ~10-50ms per task — impossible to click Pause in that window. The `wait` task blocks on a Temporal timer for 10s, giving a massive stable window.
- **Orchestrator phase update is immediate**: The Go orchestrator updates DB phase to PAUSED on signal receipt. The UI reflects this via polling/streaming before the engine cooperatively freezes. E2E tests can reliably assert phase badge changes.
- **Session URL never contains execution ID**: Navigation is pushState to `/sessions/{id}`. Assertions use sidebar region and phase badges, not URL-based execution tracking.

## Benefits

- **Deployment confidence**: The two most critical user journeys now have end-to-end verification
- **Deterministic offline tests**: Workflow Run/pause/cancel tests need zero API keys
- **Flake-resistant design**: Timer-based blocking (not race conditions) for lifecycle tests
- **Incremental over existing**: Builds on proven infrastructure without duplicating existing session-flow or workflow-execution-flow tests

## Impact

- Interactive E2E test count: 8 → 17 (9 new tests across 2 new spec files)
- Total E2E test files: 26 → 28
- Zero new dependencies

---

**Status**: ✅ Production Ready
**Timeline**: Single session
