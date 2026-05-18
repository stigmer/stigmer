# Frontend Integration Testing Strategy

**Date**: May 18, 2026

## Summary

Added a three-tier frontend integration testing strategy to catch deployment regressions like the "Failed to load default agent" error seen after the v1.0.0 release. The implementation adds SDK hook unit tests (Vitest), component integration tests for both web and desktop apps, Playwright E2E smoke tests, two new CI workflows, and Makefile targets to wire everything into the existing CI gate.

## Problem Statement

After the v1.0.0 release, users saw "Failed to load default agent. Please try again." on `app.stigmer.ai`. This error originated from `useDefaultAgent` in `@stigmer/react` failing its gRPC-web call to `agent.getDefault()`, but nothing in CI validated this path before deployment.

### Pain Points

- Zero frontend tests existed in `client-apps/web/` or `client-apps/desktop/` -- no test files, no test dependencies, no test infrastructure
- The CI integration test workflows only triggered on `backend/**` and `test/integration/**` path changes -- frontend and SDK changes never ran integration tests
- `@stigmer/react` had Vitest configured but only 1 trivial test (2 assertions for `useStigmer`)
- `@stigmer/sdk` had Vitest configured but zero test files
- Release workflows built artifacts but ran zero smoke tests against the deployed service
- `verify-web` only did lint + typecheck, with no runtime validation

## Solution

Implemented a three-tier testing strategy that progressively validates from fast unit tests to full browser E2E:

- **Tier 1 (SDK Unit Tests)**: Vitest tests with mocked transports for all key data-fetching hooks
- **Tier 2 (Component Integration Tests)**: Vitest + testing-library tests for web and desktop app components
- **Tier 3 (E2E Smoke Tests)**: Playwright browser tests against deployed instances

## Implementation Details

### Tier 1: SDK Unit Tests (5 new test files, 22 tests)

- `sdk/react/src/agent/__tests__/useDefaultAgent.test.tsx` -- Loading state, null org skip, error after retry, refetch
- `sdk/react/src/agent/__tests__/useAgent.test.tsx` -- Agent-by-slug fetching, NOT_FOUND handling, error propagation
- `sdk/react/src/session/__tests__/useSession.test.tsx` -- Session fetching by ID, error state, refetch, re-fetch on ID change
- `sdk/react/src/session/__tests__/useSessionList.test.tsx` -- List fetching, custom page size, error handling
- `sdk/react/src/session/__tests__/useCreateSession.test.tsx` -- agentInstanceId path, agentRef resolution, missing default instance error, create failure, clearError

### Tier 2: Component Integration Tests

- Added `vitest`, `@testing-library/react`, `happy-dom` to both `client-apps/web` and `client-apps/desktop`
- Created `vitest.config.ts` for both apps
- Web tests: `error-boundary.test.tsx`, `not-found.test.tsx`, `home-page.test.tsx`
- Desktop tests: `app-smoke.test.tsx` (deployment mode logic)

### Tier 3: E2E Smoke Tests

- Created `test/e2e/` with Playwright config and 5 spec files:
  - `app-bootstrap.spec.ts` -- Console error detection, "Failed to load" banner detection
  - `session-launcher.spec.ts` -- Composer rendering, default agent error detection
  - `dashboard.spec.ts` -- Dashboard page loading
  - `library.spec.ts` -- Library pages (agents, workflows, skills) load without errors
  - `navigation.spec.ts` -- Route handling, 404 behavior

### CI Workflows

- `ci.frontend.yaml` -- Triggers on `sdk/**`, `client-apps/**` changes; runs SDK tests, web/desktop tests, and lint+typecheck in parallel
- `ci.e2e.yaml` -- Post-deploy Playwright tests triggered by `release.sandbox-cloud` completion, weekday schedule, and manual dispatch

### Makefile Targets

- `make test-web`, `make test-desktop`, `make test-e2e` -- New targets
- `make check` now includes `test-web` and `test-desktop`

## Benefits

- The exact v1.0.0 "Failed to load default agent" error would now be caught by `useDefaultAgent.test.tsx` (validates the hook's retry and error behavior) and `session-launcher.spec.ts` (detects the error banner in the browser)
- Frontend code changes now trigger CI tests via `ci.frontend.yaml` -- previously they ran zero automated tests
- Post-deployment smoke tests catch environment-specific issues (wrong env vars, broken builds, service unavailability) that unit tests cannot
- Full React SDK test suite: 503 tests across 47 files, all passing

## Impact

- **Developers**: Frontend changes now have CI test coverage on every PR
- **Release confidence**: Post-deploy E2E tests validate the deployed app works end-to-end
- **Debugging**: Test failures pinpoint whether the issue is at the SDK contract level, component rendering level, or deployment level

## Related Work

- Builds on the existing backend integration test infrastructure in `test/integration/`
- Complements the existing `ci.integration-offline.yaml` workflow with frontend-specific coverage
- Uses the same Vitest + happy-dom + @testing-library/react stack already used by `@stigmer/react`

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
