# Fix MCP EnvVar Resolution Integration Test

**Date**: May 22, 2026

## Summary

Fixed the `MCP_EnvVarResolution` integration test (2 subtests: native + cursor) by passing `runtime_env` at Connect time. The test was failing because the `ConnectMcpServer` harness helper did not support passing environment variables, causing the backend to fall back to a personal environment that doesn't exist in the test harness.

## Problem Statement

The `MCP_EnvVarResolution` test creates an MCP server with a declared env var (`TEST_SECRET`, required, `is_secret=true`), then calls `ConnectMcpServer` which invokes the `Connect` RPC **without** `runtime_env`. The Connect handler sees env declarations and attempts to resolve them from the caller's personal environment. Since no personal environment exists for `test-org` in the test harness, Connect fails with `FailedPrecondition`.

### Pain Points

- Both `/native` and `/cursor` subtests failed at the Connect step before reaching execution
- The `ConnectInput` proto already supported `runtime_env` (used by the CLI and canary tests), but the harness helper didn't expose it
- The test was added with `WithRuntimeEnv` on the execution but the Connect step was overlooked

## Solution

Extended the `ConnectMcpServer` harness helper with a variadic `ConnectOption` pattern (consistent with `AgentExecutionOption` and `SessionOption` in the same package), then updated the test to pass the secret value at Connect time.

## Implementation Details

### `test/integration/harness/mcp_helpers.go`

- Added `ConnectOption func(*mcpserverv1.ConnectInput)` type
- Added `WithConnectRuntimeEnv(env)` option function
- Updated `ConnectMcpServer` signature to `...ConnectOption` (backward-compatible — all 18 existing callers pass zero options)

### `test/integration/agent_execution_03_mcp_test.go`

- Updated `TestAgentExecution_MCP_EnvVarResolution` to pass `WithConnectRuntimeEnv` with the same `TEST_SECRET` value used for execution

## Benefits

- `MCP_EnvVarResolution/cursor` now passes end-to-end
- `MCP_EnvVarResolution/native` gets past Connect (now blocked only by pre-existing Category 2 runner bugs: `checkpoint.pending_sends` and `tool_use.id` missing)
- The `ConnectOption` pattern is reusable for future tests that need to pass env vars at Connect time

## Impact

- 2 integration test subtests unblocked from Category 3 failure
- No production code changes — only test harness and test code
- No proto or dependency changes

---

**Status**: Production Ready
