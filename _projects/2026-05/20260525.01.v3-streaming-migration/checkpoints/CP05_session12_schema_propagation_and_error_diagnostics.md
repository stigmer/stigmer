# Checkpoint CP05: Session 12 — Schema Propagation Tests + Error Diagnostics

**Date**: 2026-05-27
**Session**: 12
**Commits**: `4346bf60e`, `89a3340ac`

## What Was Accomplished

### 1. Cursor SDK Error Classification + Poisoned-Handle Recovery (`4346bf60e`)

Addresses a confirmed Cursor SDK bug where `run.wait()` returns bare `{status: "error"}` with no detail while the real ConnectError leaks as `process.unhandledRejection`.

- **error-classifier.ts**: Classifies errors into auth/rate-limit/network/agent-stale/model/unknown with retryable flag
- **rejection-capture.ts**: Captures ConnectError from process-level unhandledRejection, correlates to active execution via AsyncLocalStorage
- **Poisoned-handle recovery**: When a resumed agent handle fails with network/agent-stale, automatically disposes and retries with a fresh agent (one retry attempt)
- **Three error sources synthesized** in priority: SDK result fields > stream ERROR status > captured ConnectError
- Wired through `main.ts`, `runner-manager.ts`, `runner.ts`

### 2. Structured Output Schema Propagation Tests (`89a3340ac`)

Verifies `output.schema` survives the expression resolution pipeline and reaches `ctx.callAgent` / `executionConfig.structuredOutputSchema` intact. Covers the daily-notification-plan production bug where schema was intermittently missing.

- 7 call-agent contract tests (schema → executionConfig propagation)
- 6 CallAgentTaskBuilder tests (schema preserved through expression resolution)
- Golden test #26 (full daily-notification-plan pattern with embedded env expressions)
- Go integration test for workflow structured output schema propagation
- CallAgent session naming diagnostic logs

## Test Results

- 91/91 affected tests pass (3 test files: call-agent-contracts, golden-execution, call-agent task builder)
- TypeScript typecheck: new test follows pre-existing patterns (state.context unknown, config possibly undefined — consistent with all other golden execution tests)
- No regressions

## Key Decisions

- Error classification is pattern-based (string matching against known gRPC/HTTP error signatures)
- Poisoned-handle retry fires only once per execution, only for resumed handles, only for network/agent-stale categories
- Schema propagation tests cover the full matrix: schema alone, schema+model, nested arrays/objects, expression-resolved messages, empty env vars

## Remaining Work

- Phase 6: Custom Stigmer Stream Transformers (future)
- E2E validation with real sub-agent execution
- Harden integration test assertions for sub-agent data
- Collect golden run corpus (optional)
