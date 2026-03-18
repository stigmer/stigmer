# SDK Foundation Test Suite

**Date**: March 18, 2026

## Summary

Established the first test infrastructure and foundation test suite across the entire TypeScript SDK surface (`@stigmer/sdk`, `@stigmer/react`, `@stigmer/theme`). This addresses the complete absence of automated tests, covering 10 test files with 142 tests targeting the load-bearing joints of the SDK: serialization, error handling, streaming lifecycle, and React hook orchestration.

## Problem Statement

Zero tests existed across the entire TypeScript SDK surface. Untested code is effectively prototype code — any refactoring, dependency upgrade, or proto schema change could silently break consumers. A concrete example: the `stripUndefined` serialization bug would have been caught immediately by even basic integration tests.

### Pain Points

- No automated verification of protobuf serialization correctness
- No tests for error classification, wrapping, or user-facing message extraction
- No tests for React hook lifecycle (streaming, conversation orchestration, abort/reconnect)
- No test infrastructure (no test runner, no DOM environment for React hooks)
- Hand-written tests placed inside `src/gen/` would be destroyed by codegen (`rm -rf src/gen`)

## Solution

Set up Vitest across all three SDK packages with appropriate environments (Node for `@stigmer/sdk`, happy-dom for `@stigmer/react`), then implemented targeted foundation tests for the most critical code paths — prioritizing "load-bearing joints" over breadth coverage.

## Implementation Details

### Test Infrastructure (all three packages)

- **Vitest** as the test runner for ESM/TypeScript compatibility
- **@testing-library/react** + **happy-dom** for React hook testing
- Per-package `vitest.config.ts` with appropriate `include` patterns
- Root-level `test` script orchestrating all three packages
- `@stigmer/theme` configured with `passWithNoTests: true` (no tests yet, but infra is ready)

### @stigmer/sdk — 5 test files

| Test File | What It Covers |
|---|---|
| `config.test.ts` | `validateConfig()` — rejects missing baseUrl, missing auth, dual auth |
| `proto-utils.test.ts` | `stripUndefined()` — removes undefined, preserves falsy values |
| `gen/errors.test.ts` | `StigmerError`, `wrapError()`, predicate functions |
| `errors.test.ts` | `classifyError()`, `isRetryableError()`, `getUserMessage()`, `annotateRpcError()` |
| `gen/session-client.test.ts` | Proto serialization roundtrip via capturing mock transport |

### @stigmer/react — 5 test files

| Test File | What It Covers |
|---|---|
| `hooks.test.tsx` | `useStigmer()` outside provider throws descriptive error |
| `group-sessions.test.ts` | `groupSessionsByTime()` — time bucketing, empty groups, missing timestamps |
| `execution-phases.test.ts` | `isTerminalPhase()` — terminal vs non-terminal phase classification |
| `useExecutionStream.test.tsx` | Streaming lifecycle: connect, stream, terminal phase, abort, reconnect, cleanup |
| `useSessionConversation.test.tsx` | Orchestration: loading, error, completed filtering, follow-up, optimistic updates |

### Test File Location Strategy

Tests for generated code live in `src/__tests__/gen/` (not `src/gen/__tests__/`) to survive the codegen `rm -rf src/gen` step in the Makefile.

## Benefits

- First line of defense against proto serialization regressions
- Error handling contract is now verified (classification, retryability, user messages)
- React hook lifecycle behavior is documented through tests (streaming, abort, reconnect)
- Foundation for CI integration — `npm test` from root runs the full suite
- New contributors can verify correctness without manual testing

## Impact

- **SDK consumers**: Higher confidence in SDK correctness across releases
- **SDK developers**: Safe refactoring with immediate regression feedback
- **CI/CD**: Ready for integration into build pipeline with a single `npm test` command

## Related Work

- Builds on the `@stigmer/sdk` codegen pipeline (`tools/codegen/generator/sdk_client_ts.go`)
- Complements the session-first web UX work (`20260317.01.session-first-web-ux`)
- Complements the core thread streaming work (`20260317.02.sp.core-thread-streaming`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
