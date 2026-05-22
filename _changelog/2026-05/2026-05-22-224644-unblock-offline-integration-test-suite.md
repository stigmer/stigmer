# Unblock Offline Integration Test Suite

**Date**: May 22, 2026

## Summary

The deterministic offline integration test suite (`test/integration-offline/`) was effectively broken — only 3 of 26 tests could run before the suite hung on 240-second timeouts and panicked. Three root causes were identified and fixed in a single session, bringing the suite to 12/26 passing with all 26 tests executing in under 90 seconds total.

## Problem Statement

The offline test suite validates the full execution pipeline (runner, LLM mock, tool dispatch, status publishing) without live LLM providers. It uses recorded responses and session-based Temporal routing to achieve deterministic, API-key-free testing.

### Pain Points

- **240s hangs per HITL test**: `ConnectMcpServer` dispatched a Temporal workflow to the `stigmer_runner` queue — but the offline suite uses session-based routing where no worker polls that queue
- **60s hangs per MCP test**: The runner's `backfillMcpServersIfNeeded()` made the same unpolled-queue call during every execution setup
- **Empty model responses**: LangGraph's `streamEvents()` sends streaming requests (`stream: true`), but the mock proxy returned plain JSON — the Anthropic SDK couldn't parse SSE format and produced empty responses
- **Net effect**: 3 tests passed, the 4th hung for 240s, and the suite panicked at the 10-minute timeout. The remaining 22 tests never ran.

## Solution

Three targeted fixes addressing each root cause, plus one name-length fix:

1. **Remove unnecessary `ConnectMcpServer` calls** from HITL offline tests — the runner discovers tools directly via stdio
2. **Add `SKIP_MCP_CONNECT_BACKFILL` env var** to bypass the runner's connect-backfill that also routes through the unpolled queue
3. **Add SSE streaming support** to `MockLLMProxyServer` — converts recorded JSON responses into proper Anthropic/OpenAI SSE event streams
4. **Fix agent name exceeding 63-char API limit** in ToolCall proto contract test

## Implementation Details

### ConnectMcpServer removal (`hitl_offline_test.go`)

All 5 HITL tests called `harness.ConnectMcpServer()` before creating agents. This RPC starts a Temporal workflow on the `stigmer_runner` queue to discover MCP server tools. In the offline suite, the runner handles tool discovery internally via stdio connections — the pre-connect was inherited from the regular integration tests where a global worker handles the queue.

### Connect-backfill skip (`connect-backfill.ts`, `unified_runner.go`)

The runner's setup pipeline (`setup.ts` line 175) calls `backfillMcpServersIfNeeded()` for any MCP server with empty `discoveredCapabilities`. This makes a synchronous gRPC call to the Java service's Connect workflow — same unpolled-queue problem. The fix adds a `SKIP_MCP_CONNECT_BACKFILL` environment variable checked at module load time. The test harness's `buildUnifiedRunnerEnv()` sets it for all runner instances.

### SSE streaming mock (`mock_llm_proxy.go`)

Added `writeAnthropicSSE()` and `writeOpenAISSE()` methods that detect `"stream": true` in request bodies and convert recorded responses into proper SSE event sequences:

- **Anthropic**: `message_start` → per-block `content_block_start` / `content_block_delta` / `content_block_stop` → `message_delta` → `message_stop`
- **OpenAI**: `data: {chunk}` → `data: {done_chunk}` → `data: [DONE]`

Tool-use blocks emit `input_json_delta` events with the serialized tool input.

## Benefits

- **Suite execution time**: From "hangs indefinitely" to ~90 seconds for all 26 tests
- **Test coverage**: 12 tests now pass (eval, LLM call, HITL auto-approve, lifecycle)
- **Fast iteration**: All failures are fast (~2-3s each) instead of 240s timeouts
- **CI viability**: The suite can now run in CI without timing out

## Impact

- **Test infrastructure**: `MockLLMProxyServer` now supports streaming, which will benefit any future tests that use LangGraph-based execution
- **Runner configuration**: The `SKIP_MCP_CONNECT_BACKFILL` flag provides a clean way to disable the backfill for any environment without a global Temporal worker
- **Remaining work**: 13 tests still fail, primarily due to MCP server stdio connections not providing tools during agent execution — documented in `_cursor/offline-test-session-2026-05-22-evening.md`

## Related Work

- Previous session: `_cursor/integration-test-fixes-2026-05-22.md` — fixed eval test failures via `engine-core.ts` ActivityFailure unwrapping
- Previous session: `_cursor/deterministic-tests-remaining-work.md` — authored all 26 offline tests
- Previous session: `_cursor/provider-test-failures-2026-05-22.md` — fixed cursor harness JWT auth (commit `de92b49cd`)

---

**Status**: In Progress
**Timeline**: Single evening session (~2 hours)
