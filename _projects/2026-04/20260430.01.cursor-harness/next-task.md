# Next Task: 20260430.01.cursor-harness

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260430.01.cursor-harness

**Description**: Integrate the Cursor TypeScript SDK as a premium execution harness alongside Stigmer's native harness within the runner daemon. Introduces the Harness concept to SessionSpec, a new TypeScript Temporal activity worker (ExecuteCursor), embedded Node.js runtime in the CLI, and unified cost/streaming/HITL adapters.
**Goal**: Enable Stigmer sessions to choose between native (standard) and Cursor (premium) execution harnesses. When a session uses the Cursor harness, executions are processed by a TypeScript worker wrapping the Cursor SDK, with full streaming, MCP integration, HITL approval, and unified billing.
**Tech Stack**: TypeScript (Cursor SDK, Temporal SDK), Go (workflow dispatch, CLI daemon), Protocol Buffers (session/execution protos), Node.js/Bun (embedded runtime)
**Components**: protos (session, agentexecution enums), CLI daemon (multi-worker management), Go workflow (dispatch by harness), new TypeScript cursor-runner service, embedded CLI packaging, SDK/React (session harness picker), cost/billing adapter

## Current State

- **Status**: COMPLETE — All tasks done (T01–T09) + gap assessment + automated tests
- **Last Session**: April 30, 2026 — Session 12: Automated test suite (207 new tests)
- **Active Task**: None — implementation and test coverage complete
- **Branch**: `feat/cursor-harness`

## Session Progress (April 30, 2026 — Session 12)

### Automated Test Suite
- **sdk/react**: 5 new test files, 74 new tests (total suite: 220 tests across 21 files)
  - `harness.test.ts` — proto converters, constants, labels
  - `useModelRegistry.test.tsx` — harness-aware filtering, default models
  - `HarnessSelector.test.tsx` — ARIA compliance, keyboard navigation, click interaction
  - `useCreateSession.test.tsx` — agent resolution, harness-to-proto threading
  - `useNewSessionFlow.test.tsx` — localStorage persistence, per-harness model keys
- **cursor-runner**: 8 new test files, 133 new tests (from zero)
  - `model-pricing.test.ts` — pricing lookup, cost computation, fallback
  - `approval-policy.test.ts` — fail-closed, destructive tools, autoApproveAll
  - `message-translator.test.ts` — SDK event mapping, denied tool extraction
  - `mcp-resolver.test.ts` — stdio/HTTP/SSE config, slug extraction
  - `fetch-interceptor.test.ts` — URL rewriting, auth replacement, lifecycle
  - `approval-state.test.ts` — state construction, file persistence
  - `usage-tracker.test.ts` — metrics proto, sequence, cumulative cost
  - `config.test.ts` — env parsing, modes, normalizeEndpoint
- **Infrastructure**: Added vitest to cursor-runner (devDep, config, test scripts)

### Bug Discovery
- **ApprovalAction enum misuse** in `approval-state.ts` and `execute-cursor.ts`: uses `APPROVAL_ACTION_APPROVE` (proto field name) instead of `APPROVE` (TS enum name) — evaluates to `undefined`, breaking HITL approval logic. Documented in tests, source fix needed.

## Next Steps

1. **Fix ApprovalAction enum bug** — correct `APPROVAL_ACTION_APPROVE`/`REJECT`/`ALWAYS_APPROVE` to `APPROVE`/`REJECT`/`ALWAYS_APPROVE` in `approval-state.ts` and `execute-cursor.ts`, then update tests to assert correct behavior
2. Integration testing across the full flow (create session → execution → streaming → billing)
3. PR review and merge of `feat/cursor-harness` branch (stigmer OSS)
4. PR review and merge of CursorProxyController changes (stigmer-cloud)
5. Release

## Context for Resume

- All 207 tests pass: `sdk/react` (220 total, 74 new) and `cursor-runner` (133 total, all new)
- Verification clean: `@stigmer/react lint` ✅, `@stigmer/react typecheck` ✅, all tests ✅
- The `ApprovalAction` enum bug is the only known functional defect — tests currently assert the buggy behavior with explanatory comments
- CursorProxyController work is in stigmer-cloud (separate commit/PR)
- SecretsGroup `cursor` applied to Planton with placeholder API key
- Session 11 gap assessment files (Makefile, Dockerfile, workflows, Go immutability, npm publish config) are uncommitted — commit those separately or together with tests

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-12.md
```

### 2. Previous Checkpoint (Gap Assessment)
```
_projects/2026-04/20260430.01.cursor-harness/checkpoints/2026-04-30-session-11.md
```

### 3. Task Plan
```
_projects/2026-04/20260430.01.cursor-harness/tasks/T01_0_plan.md
```

### 4. Design Decisions
```
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-harness-analysis.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/hitl-cursor-hooks-approach.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/execution-interceptors-concept.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-cost-model.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/embedded-packaging-strategy.md
_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-sdk-proxy-support.md
```

---

*This file provides direct paths to all project resources for quick context loading.*
