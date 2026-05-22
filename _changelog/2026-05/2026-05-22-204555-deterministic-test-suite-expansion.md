# Deterministic Test Suite Expansion: Eval, LLM Call, Lifecycle, and Canary

**Date**: May 22, 2026

## Summary

Expanded the deterministic offline integration test suite from 12 to 26 tests by adding eval, LLM call, and lifecycle offline tests. Created a 5-test canary suite for nightly live provider health checks. Wired both suites into CI with proper artifact collection and JUnit reporting.

## Problem Statement

The initial offline test suite covered MCP tool dispatch, HITL approval flows, and Workflow Architect operations, but left three major areas untested with recorded LLM responses: eval task execution, LLM call workflows, and agent lifecycle control (cancel/terminate/pause/recover). Provider health monitoring also had no dedicated nightly canary.

### Pain Points

- Eval and LLM call workflows still required live LLM API calls, making them non-deterministic and expensive
- Agent lifecycle control tests (cancel, pause, terminate, recover) relied on slow MCP tools or real LLM responses for timing, causing flaky races
- No dedicated nightly canary to detect provider regressions (model retirement, proxy breakage)
- The `test/integration-offline/` suite was not wired into the PR CI workflow

## Solution

Added 14 new deterministic offline tests across three domains, created a 5-test live provider canary suite, and wired everything into GitHub Actions CI.

## Implementation Details

### New offline tests (14 tests, 3 files)

**`eval_offline_test.go`** (3 tests): Ports the live eval workflow tests using `AddWorkflowExecution()` routing with mock LLM responses. Tests PassFail, NumericScore, and WarnPolicy eval modes.

**`llm_call_offline_test.go`** (3 tests): Ports the live llm_call workflow tests for StructuredOutput, SimplePrompt, and OpenAI StructuredOutput. The OpenAI test uses a new `OpenAITextResponse()` helper added to `mock_llm_proxy.go`.

**`lifecycle_offline_test.go`** (8 tests): Ports the agent lifecycle control tests using "keep-alive" mock entries (tool call + text response) to keep executions alive for lifecycle actions. Covers Cancel, CancelIdempotent, CancelTerminalFails, Terminate, Pause/Resume, Recover, TerminateIdempotent, and TerminateTerminalFails.

### Canary suite (5 tests, 1 file)

**`canary_test.go`**: Minimal live provider tests that assert only `phase == COMPLETED`. Covers NativeAgentCompletes, CursorAgentCompletes, LlmCallProxy, McpToolStdio, and McpToolHttp. All skip gracefully without API keys.

### Harness additions

- `OpenAITextResponse()` helper in `mock_llm_proxy.go` for building mock OpenAI chat completion responses

### CI wiring

- Added `test/integration-offline/**` to `ci.integration-offline.yaml` path triggers
- Added Suite 5 step running `make test-integration-offline` with artifact upload and JUnit reporting
- Created `ci.integration-canary.yaml` nightly workflow (6 AM UTC daily) using `provider-integration` environment secrets

### Makefile targets

- `make test-integration-canary` (root) delegates to `make test-canary` in `test/integration/Makefile`
- Canary target auto-fetches API keys from Planton if not set in environment

### Pre-requisite fix

- Fixed stale `mcp-server/go.sum` via `go mod tidy` so the mcp-server-stigmer binary builds correctly

## Benefits

- **Deterministic coverage**: 26 offline tests now cover MCP, HITL, Workflow Architect, eval, LLM call, and lifecycle without any LLM API calls
- **Provider monitoring**: Nightly canary detects model retirement, proxy breakage, and API key expiry before they impact users
- **CI integration**: Offline suite runs on every PR, catching regressions early without API costs
- **Faster feedback**: All 26 offline tests run without external dependencies, completing in under 5 minutes

## Impact

- Test suite: 12 → 26 offline tests (117% increase), plus 5 canary tests
- CI: Offline suite now runs as Suite 5 on every PR; canary runs nightly
- Cost: Zero API cost for offline tests; canary costs under $0.05/run

## Related Work

- [Deterministic Offline Integration Test Suite](_changelog/2026-05/2026-05-22-203511-deterministic-offline-integration-test-suite.md) — initial 12-test suite and MockLLMProxyServer infrastructure

---

**Status**: ✅ Production Ready
