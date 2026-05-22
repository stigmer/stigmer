# Playwright Interactive Infrastructure

**Date**: May 21, 2026

## Summary

Built the foundational Playwright E2E test infrastructure that enables interactive tests against a live Stigmer backend — custom fixtures with typed API seeding, server lifecycle management (Temporal + stigmer-server + unified runner), domain-scoped interaction helpers with verified ARIA locators, and three first interactive test specs covering library CRUD, workflow execution, and session chat flows.

## Problem Statement

The existing 23 Playwright specs are purely structural — they assert DOM elements exist but cannot test real user journeys because no backend is running, no data is seeded, and no shared helpers exist.

### Pain Points

- Tests pass vacuously on empty databases (guard with `if (await el.isVisible())`)
- No mechanism to create agents, workflows, or sessions before tests
- All locators duplicated inline across 23 files with no shared infrastructure
- Cannot test the most critical flows: execution streaming, library navigation with real data, workflow completion
- No isolation between tests — any backend state bleeds across

## Solution

Introduced a third Playwright project (`interactive`) with full backend stack orchestration, TypeScript SDK-based data seeding, and domain-scoped interaction helpers. The infrastructure uses a reuse-or-start pattern — if a developer already has `stigmer up` running, globalSetup detects the backend on `:7234` and skips startup.

## Implementation Details

### New files (13 total)

**Infrastructure layer:**
- `fixtures/server-manager.ts` — TCP readiness polling, Temporal/server/runner process lifecycle, isolated temp directory
- `global-setup.ts` — reuse-or-start pattern (TCP check → start if absent → write state file)
- `global-teardown.ts` — kill only what we started, clean temp directory
- `fixtures/index.ts` — `test.extend` with `stigmerClient` (worker-scoped), `testAgent`/`testWorkflow` (test-scoped, auto-cleanup)
- `fixtures/seed-helpers.ts` — `createTestAgent`, `createTestWorkflow`, `createTestWorkflowExecution`

**Interaction helpers (verified ARIA locators from SDK component deep-dive):**
- `helpers/navigation.ts` — `assertNoErrorBoundary`, `waitForPageReady`, `getSidebar`
- `helpers/library.ts` — `navigateToAgents`, `verifyResourceInList`, `clickResourceCard`
- `helpers/workflow-execution.ts` — `navigateToExecution`, `waitForPhaseBadge`, `getExecutionTimeline`
- `helpers/session.ts` — `startNewSession`, `sendFollowUp`, `waitForAIResponse`, message thread accessors

**Interactive test specs:**
- `tests/interactive/library-flow.spec.ts` — offline, server only
- `tests/interactive/workflow-execution-flow.spec.ts` — offline, needs runner (set_vars tasks)
- `tests/interactive/session-flow.spec.ts` — canary tier (LLM-gated)

### Modified files

- `package.json` — added `"test/e2e"` to workspaces
- `test/e2e/package.json` — added `@stigmer/sdk`, `@connectrpc/connect-node`, `@stigmer/protos`, `@bufbuild/protobuf`
- `test/e2e/playwright.config.ts` — new `interactive` project, `globalSetup`/`globalTeardown`
- `Makefile` — new `test-e2e-interactive` target

### Key architectural decisions

- **TCP dial for health check** (no `/healthz` exists on stigmer-server)
- **ARIA-first locators** (app has zero `data-testid` — all helpers use `role`, `aria-label`, visible text)
- **pushState awareness** (sessions and library detail use `history.pushState`, not Next.js navigation)
- **Queue alignment** (`stigmer_runner` set on both server and runner env vars)
- **Runner stdout pattern matching** for readiness (`/Worker ready, polling for tasks/`)
- **Isolated temp directory** for all server state (DB, storage, workspace) — no dev data contamination

## Benefits

- Two fully offline interactive tests validate complete Playwright infrastructure end-to-end in every CI run
- Session canary proves real LLM execution flow works (nightly/pre-deploy)
- Interaction helpers eliminate locator duplication for future test authors
- Reuse-or-start pattern means zero wait time for developers who already have `stigmer up` running
- Foundation for expanding to settings, authorization, and workflow editor interactive tests

## Impact

- Unblocks all future interactive E2E work (previously impossible without this infrastructure)
- Three new test categories: library CRUD, workflow execution, session chat
- Makefile target `make test-e2e-interactive` for CI integration

---

**Status**: ✅ Production Ready
**Timeline**: Single session
