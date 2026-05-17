# Agent Execution Integration Test Suite

**Date**: May 15, 2026

## Summary

Built a comprehensive integration test suite for the agent execution pipeline — the core of the Stigmer platform. Added 23 test functions (45 subtests) covering direct agent execution, HITL approval flows, lifecycle control, MCP server integration, skill injection, sub-agent delegation, file attachments, and execution config overrides. Every test runs on both harnesses (native Graphton + Cursor SDK) via table-driven subtests, enforcing cross-harness behavioral parity by construction.

## Problem Statement

The existing 28 integration tests covered workflow execution thoroughly but had zero coverage for direct agent execution — the primary user-facing flow. Every CLI `stigmer run`, web console session, and SDK integration flows through the agent execution pipeline, yet none of the following were tested:

### Pain Points

- No tests for direct `AgentExecution.create` via gRPC
- No tests for HITL tool approval flow (approve/skip/reject)
- No tests for MCP server connection and tool execution at runtime
- No tests for skill injection into agent context
- No tests for sub-agent delegation
- No tests for execution lifecycle control (pause/resume/cancel/terminate/recover)
- No tests for cross-harness parity (native vs cursor behave identically)
- Integration test targets bloating the root Makefile

## Solution

Designed and implemented a table-driven cross-harness test architecture where every test function iterates over `[]HarnessConfig{native, cursor}` and runs `t.Run(h.Name, ...)` for each. Platform-level assertions (phases, approval states, lifecycle transitions) are identical across harnesses. Runner-level differences are handled via conditional branches within the test body.

## Implementation Details

### Harness Infrastructure (4 new files)

- `harness/harness_config.go` — `HarnessConfig` type, `Harnesses` slice, `RequireNativePrereqs`/`RequireCursorPrereqs` skip helpers, `CreateTestSession`, `CreateTestAgentExecution` with option functions
- `harness/agent_execution_waiter.go` — `AgentExecutionWaiter` with `WaitForPhase`, `WaitForApproval`, `WaitForTerminal`, plus assertion helpers (`AssertAgentPhase`, `AssertMessages`, `AssertHasToolCall`, `AssertToolCallMcpSlug`, `AssertSubAgents`, `AssertPendingApprovals`)
- `harness/agent_factory.go` — `CreateAgent` with functional options (`WithMcpServerUsage`, `WithMcpServerUsageAndApproval`, `WithSkillRef`, `WithSubAgent`), auto-cleanup via `t.Cleanup`
- `harness/mcp_helpers.go` — `BuildTestMcpServer`, `CreateStdioMcpServer`, `CreateHttpMcpServer`, `ConnectMcpServer`

### Test MCP Server (1 new file)

- `testdata/mcp-test-server/main.go` — Deterministic stdio MCP server implementing JSON-RPC 2.0 with four tools: `echo`, `add`, `fail`, `slow`. Compiled once in `TestMain`, binary path shared across tests.

### gRPC Clients Extended

- `harness/clients.go` — Added `AgentExecutionCommand`, `SessionCommand`, `McpServerCommand`, `McpServerQuery`, `SkillCommand`, `SkillQuery` clients

### Test Files (8 families + helpers)

- `agent_execution_lifecycle_test.go` — 4 tests (create validation, happy path, structured output, multi-turn)
- `agent_execution_hitl_test.go` — 5 tests (approve, skip, reject, auto-approve, wrong-phase)
- `agent_execution_lifecycle_control_test.go` — 5 tests (cancel, cancel-idempotent, cancel-terminal, terminate, pause/resume)
- `agent_execution_mcp_test.go` — 3 tests (stdio tool execution, tool failure, enabled_tools filter)
- `agent_execution_skills_test.go` — 1 test (agent-level skill injection)
- `agent_execution_subagent_test.go` — 2 tests (delegation, parent-cancel cascade)
- `agent_execution_attachments_test.go` — 1 test (upload + storage_key)
- `agent_execution_config_test.go` — 2 tests (max tool rounds, model override)
- `agent_execution_helpers_test.go` — `createTestSkill`, `createSkillZip`

### Makefile Extraction

Extracted all integration test targets from the root Makefile (685 -> 582 lines) into `test/integration/Makefile`. Root Makefile now has thin delegates. Added `test-integration-agent` target for agent execution tests only.

## Benefits

- **Cross-harness parity by construction**: Every test proves both harnesses (native + cursor) behave identically. A parity failure shows up as `TestFoo/native PASS + TestFoo/cursor FAIL` — immediately visible.
- **First run found real issues**: 4 subtests passed on first execution, others revealed genuine platform issues (R2 storage unavailable in test mode, MCP tool discovery gap, model name resolution differences).
- **Zero regression**: All 28 existing workflow tests continue to pass (verified with `make test-integration`).
- **Makefile separation of concerns**: Integration test logic lives with the test code, root Makefile is clean.

## Impact

- **Test count**: 28 existing -> 51 total (23 new test functions, 45 new subtests)
- **Coverage areas**: 8 new test families covering the entire agent execution surface
- **Files**: 16 new files, 4 modified files
- **Root Makefile**: Reduced from 685 to 582 lines

## Related Work

- Session 14-15: Cursor runner harness and unified agent_call (built the foundation this suite tests)
- T01 plan: Original E2E testing infrastructure plan
- T19: Follow-up document with test fixes and remaining coverage gaps

---

**Status**: In Progress (first run completed, fixes documented in T19)
**Timeline**: 1 session (planning + implementation + first test run)
