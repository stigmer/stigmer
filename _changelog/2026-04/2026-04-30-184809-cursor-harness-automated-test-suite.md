# Cursor Harness Automated Test Suite

**Date**: April 30, 2026

## Summary

Added comprehensive automated test suites across two packages — `sdk/react` (74 new tests in 5 files) and `backend/services/cursor-runner` (133 new tests in 8 files) — covering the harness selection, session lifecycle, cost model, HITL approval, message translation, MCP resolution, fetch interception, and configuration layers introduced by the Cursor harness feature. This also established Vitest infrastructure for the `cursor-runner` package, which previously had no test tooling.

## Problem Statement

The Cursor harness integration introduced substantial new functionality across the React SDK and the TypeScript cursor-runner service. While all features were implemented and manually verified, no automated test coverage existed for the new code paths. This left the codebase vulnerable to regressions, especially in critical areas like proto enum conversion, HITL approval policy enforcement, cost computation, and the global fetch interceptor.

### Pain Points

- `cursor-runner` had zero test infrastructure — no test runner, no config, no dev dependencies
- Proto enum converters (`toProtoHarness`/`fromProtoHarness`) lacked round-trip verification
- Harness-aware model filtering in `useModelRegistry` was untested
- The `HarnessSelector` component's ARIA compliance and keyboard navigation had no automated checks
- HITL approval policy logic (fail-closed, destructive tool detection, `autoApproveAll` bypass) was entirely unverified
- The fetch interceptor's URL rewriting and auth header replacement — a critical proxy path — had no regression coverage
- Per-harness localStorage model persistence in `useNewSessionFlow` was untested

## Solution

Implemented a 13-part automated test plan organized by package and domain, following existing test patterns (`renderHook` for hooks, `render`/`screen`/`fireEvent` for components) and establishing new infrastructure where needed.

## Implementation Details

### sdk/react (5 new test files, 74 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `models/__tests__/harness.test.ts` | 11 | HarnessOption constants, HARNESS_LABELS, toProtoHarness/fromProtoHarness round-trip |
| `models/__tests__/useModelRegistry.test.tsx` | 16 | Native vs cursor harness filtering, default model resolution, provider ordering |
| `models/__tests__/HarnessSelector.test.tsx` | 21 | Rendering, ARIA radiogroup attributes, click selection, keyboard nav (Arrow keys, wrap-around) |
| `session/__tests__/useCreateSession.test.tsx` | 11 | Agent resolution (instance ID vs reference), harness-to-proto threading, loading/error states |
| `session/__tests__/useNewSessionFlow.test.tsx` | 15 | Harness localStorage persistence, per-harness model keys, harness passed through submit flow |

### backend/services/cursor-runner (8 new test files, 133 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `adapter/__tests__/model-pricing.test.ts` | 17 | Pricing lookup, cost computation, default fallback for unknown models |
| `hitl/__tests__/approval-policy.test.ts` | 22 | Fail-closed policy, destructive vs read-only tools, autoApproveAll, MCP tool prefixes |
| `adapter/__tests__/message-translator.test.ts` | 21 | SDK event → proto mapping, denied tool call extraction, timestamp format |
| `adapter/__tests__/mcp-resolver.test.ts` | 14 | Stdio/HTTP/SSE config transform, missing field handling, slug extraction |
| `proxy/__tests__/fetch-interceptor.test.ts` | 13 | URL rewriting, auth header replacement, non-Cursor passthrough, install/uninstall lifecycle |
| `hitl/__tests__/approval-state.test.ts` | 10 | buildApprovalState construction, writeApprovalStateFile persistence |
| `adapter/__tests__/usage-tracker.test.ts` | 9 | LlmCallMetrics proto shape, sequence tracking, cumulative cost accumulation |
| `__tests__/config.test.ts` | 27 | Env parsing, mode defaults (local/cloud/proxy), normalizeEndpoint URL handling |

### cursor-runner test infrastructure

- Added `vitest` as devDependency with `test` and `test:watch` scripts
- Created `vitest.config.ts` with `resolve.alias` entries to handle ESM `.js` suffix stripping for `@stigmer/protos` imports
- Node environment configured for server-side testing

## Benefits

- **207 new automated tests** protecting critical Cursor harness paths
- **Zero-to-full test infrastructure** for `cursor-runner` — future contributors can write and run tests from day one
- **Regression safety** for proto enum conversion, cost billing, HITL approval logic, and proxy fetch interception
- **Accessibility verification** for `HarnessSelector` ARIA compliance and keyboard navigation
- **Bug discovery**: identified incorrect `ApprovalAction` enum member references in `approval-state.ts` and `execute-cursor.ts` (uses full proto field names instead of TypeScript enum names, causing comparisons against `undefined`)

## Impact

- **sdk/react**: Total test count increased from 146 to 220 (51% increase)
- **cursor-runner**: Went from 0 to 133 tests
- **Developer confidence**: All harness-related code paths now have automated regression coverage
- **CI readiness**: Both test suites integrate with existing `make check` and `npm test` targets

## Related Work

- [Cursor Runner TypeScript Service](2026-04-30-144627-cursor-runner-typescript-service.md) — the service these tests cover
- [SDK/React Session Harness Selector](2026-04-30-180023-sdk-react-session-harness-selector.md) — the UI layer these tests verify
- [Cursor Cost Model and Billing Integration](2026-04-30-170551-cursor-cost-model-billing-integration.md) — cost computation tests validate this work
- [Cursor Harness Gap Assessment Fixes](2026-04-30-184936-cursor-harness-gap-assessment-fixes.md) — `make check` targets that run these tests

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~3 hours)
