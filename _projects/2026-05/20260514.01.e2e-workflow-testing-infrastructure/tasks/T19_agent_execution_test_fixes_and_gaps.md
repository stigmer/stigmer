# T19: Agent Execution Test Fixes + Missing Test Coverage

**Created**: 2026-05-15
**Status**: READY FOR EXECUTION
**Context**: First run of `make test-integration-agent` completed. 4 subtests passed, 63 failed. This document captures every fix needed and every test gap identified.

## Quick Resume

Drop this file into a new conversation to continue. All code is on branch `feat/bring-workflows-to-foreground` in the `stigmer` repo.

## What Exists Today

### Files Created (this session)

**Harness infrastructure** (`test/integration/harness/`):
- `clients.go` — Extended with `AgentExecutionCommand`, `SessionCommand`, `McpServerCommand`, `McpServerQuery`, `SkillCommand`, `SkillQuery`
- `harness_config.go` — `HarnessConfig`, `Harnesses` slice (native + cursor), `RequireNativePrereqs`/`RequireCursorPrereqs`, `CreateTestSession`, `CreateTestAgentExecution`
- `agent_execution_waiter.go` — `AgentExecutionWaiter` with `WaitForPhase`, `WaitForApproval`, `WaitForTerminal`, assertion helpers
- `agent_factory.go` — `CreateAgent` with `WithMcpServerUsage`, `WithMcpServerUsageAndApproval`, `WithSkillRef`, `WithSubAgent`
- `mcp_helpers.go` — `BuildTestMcpServer`, `CreateStdioMcpServer`, `CreateHttpMcpServer`, `ConnectMcpServer`

**Test MCP server** (`test/integration/testdata/mcp-test-server/main.go`):
- Stdio JSON-RPC MCP server with `echo`, `add`, `fail`, `slow` tools
- Compiled once in `TestMain`, binary path shared via `mcpTestServerBinary` global

**Test files** (`test/integration/`):
- `agent_execution_lifecycle_test.go` — 4 tests (1 offline + 3 cross-harness)
- `agent_execution_hitl_test.go` — 5 cross-harness tests
- `agent_execution_lifecycle_control_test.go` — 5 cross-harness tests
- `agent_execution_mcp_test.go` — 3 cross-harness tests
- `agent_execution_skills_test.go` — 1 cross-harness test
- `agent_execution_subagent_test.go` — 2 cross-harness tests
- `agent_execution_attachments_test.go` — 1 cross-harness test
- `agent_execution_config_test.go` — 2 cross-harness tests
- `agent_execution_helpers_test.go` — `createTestSkill`, `createSkillZip` helpers

**Makefile** (`test/integration/Makefile`):
- All integration targets extracted from root Makefile
- Root Makefile has thin delegates: `test-integration`, `test-integration-providers`, `test-integration-agent`

### Design Decisions (Established)

- **DD-01**: Table-driven cross-harness subtests — every test runs `t.Run("native", ...)` + `t.Run("cursor", ...)`
- **DD-02**: Test MCP server in Go (stdio + HTTP)
- **DD-03**: Provider lane for agent execution tests (needs `ANTHROPIC_API_KEY`)
- **DD-04**: Shared `test-org` with unique resource names
- **DD-05**: Scope limited to functional correctness (no replay/stress)

---

## Part 1: Fixes Needed (from first run)

### Fix 1: Attachment Upload — R2 Storage Not Available

**Symptom**: `TestAgentExecution_Attachment_Upload` fails with:
```
rpc error: code = Internal desc = AgentExecutionUploadAttachmentHandler/GenerateStorageKeyAndUpload:
failed to upload attachment: Connect to localhost:19999 failed: Connection refused
```

**Root Cause**: The Java service in test mode has `CLAIMCHECK_ENABLED=false` and uses dummy R2 endpoints (`localhost:19999`). The `uploadAttachment` RPC tries to write to R2 but there's no storage backend.

**Fix Options** (decide which):
1. **Skip attachment tests** when R2 is not available (add a precondition check)
2. **Stand up MinIO** via Testcontainers as an S3-compatible store for tests
3. **Use local artifact storage** — check if the agent-runner supports `ARTIFACT_STORAGE_TYPE=local` and configure the Java service's R2 to point to a local directory

**Recommended**: Option 1 for now (skip), Option 2 as a follow-up task.

### Fix 2: HITL Tests — Agent Not Calling MCP Tools Reliably

**Symptom**: `TestAgentExecution_HITL_Approve/native` runs for 187s then times out. The agent doesn't reliably call the MCP tool, so it never enters `WAITING_FOR_APPROVAL`.

**Root Cause**: The agent needs to discover and use the test MCP server's tools. The test creates the McpServer resource but doesn't run `connect` to populate `discovered_capabilities`. Without discovery, the agent-runner may not know about the tools. Even with discovery, the LLM may not choose to use the tool.

**Fix**:
1. After `CreateStdioMcpServer`, call `ConnectMcpServer` to populate `discovered_capabilities` and `tool_approvals`
2. Make the agent instructions more deterministic: "You MUST use the echo tool. Do not respond without using it."
3. Set `auto_approve_all=false` explicitly on the execution spec (it defaults to false, but be explicit)
4. Reduce the timeout from 3min to 2min for the approval wait — if the agent can't find the tool in 2min, something is wrong

### Fix 3: Config_ModelOverride/native — Model Name Issue

**Symptom**: `TestAgentExecution_Config_ModelOverride/native` fails (cursor passes).

**Root Cause**: The test uses `claude-haiku-4-20250514` which may not be available or may have a different canonical name in the native runner's model registry. The cursor runner resolves model names differently.

**Fix**: Use a model name that is guaranteed to exist in both harnesses, or make the model name harness-conditional.

### Fix 4: Cascade Failures — Java Service Dying Under Load

**Symptom**: After ~400s of HITL tests, the Java service becomes unavailable (`connection refused`) and all subsequent tests fail.

**Root Cause**: The HITL tests are expensive (each creates an MCP server, agent, session, execution, waits 3+ min). The Java service may be running out of resources (memory, connections, Temporal queues) or the overall test timeout (600s) is too tight for 23 test functions x 2 harnesses.

**Fix**:
1. Run agent execution tests with `t.Parallel()` disabled (they already run sequentially, but verify)
2. Add cleanup between test families (close sessions, delete agents)
3. Increase timeout to 900s
4. Add health-check polling between test families

### Fix 5: Test Ordering — Connection Refused After Long-Running Tests

**Symptom**: Tests that run after the HITL family see `connection refused`.

**Root Cause**: Go's `go test` runs test functions in the order they appear in the source file within a single package. The HITL tests are in `agent_execution_hitl_test.go` which sorts alphabetically before `agent_execution_lifecycle_control_test.go`, etc. If HITL tests exhaust the Java service, everything after fails.

**Fix**: Go test runs functions in file order, and files are sorted alphabetically. Current order is:
1. `agent_execution_attachments_test.go` (fails immediately — R2)
2. `agent_execution_config_test.go` (PASSES — simple)
3. `agent_execution_helpers_test.go` (no tests)
4. `agent_execution_hitl_test.go` (long-running — kills service)
5. `agent_execution_lifecycle_control_test.go` (connection refused)
6. `agent_execution_lifecycle_test.go` (connection refused)
7. `agent_execution_mcp_test.go` (connection refused)
8. `agent_execution_skills_test.go` (connection refused)
9. `agent_execution_subagent_test.go` (connection refused)

**Fix**: Reorder by prefixing filenames with numbers or restructuring so lightweight tests run first:
- Move lifecycle (happy path) tests to run first
- Move HITL tests to run last (they are the most expensive)

---

## Part 2: Missing Test Coverage — Billing, Usage & Cost Tracking

The platform has a rich billing/usage system that is completely untested in integration. These tests would go in a new file: `agent_execution_billing_test.go`.

### Billing Gate Tests

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_Billing_AuthorizeExecution` | Execution starts only when billing account exists and has credits |
| `TestAgentExecution_Billing_NoCreditsBlocked` | Execution fails at billing gate when credits are zero |
| `TestAgentExecution_Billing_FinalizeExecution` | After completion, billing finalize is called (credits reserved are settled) |

### Usage Tracking Tests

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_Usage_RunnerUsageSummary` | After execution completes, `status.runner_usage` has non-zero `input_tokens`, `output_tokens`, `turn_count` |
| `TestAgentExecution_Usage_ExecutionReport` | `getExecutionUsageReport` returns non-zero token counts and cost after completion |
| `TestAgentExecution_Usage_SessionReport` | `getSessionUsageReport` aggregates usage across multiple executions in same session |
| `TestAgentExecution_Usage_OrgReport` | `getOrgUsageReport` includes usage from test executions |

### Cost Tracking Tests

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_Cost_CreditDebit` | After execution, credit balance decreases by the billed amount |
| `TestAgentExecution_Cost_LedgerEntry` | `getCreditLedger` shows a debit entry for the execution |
| `TestAgentExecution_Cost_CostCap` | When `max_cost_usd` is set and exceeded, execution terminates and usage reflects the cap |

### Control Signal Tests

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_Billing_ControlSignalStop` | When credits are exhausted mid-execution, `EXECUTION_CONTROL_SIGNAL_STOP` is returned and execution terminates gracefully |

### Requirements for Billing Tests

- Need `BillingQueryController` gRPC client (add `getBillingAccount`, `getCreditBalance`, `getCreditLedger`, `getBillingUsageReport`)
- Credit balance before/after comparison pattern
- May need the proxy to be active for `LlmCallUsageRecord` to be written (native tests in test mode may bypass the proxy)

---

## Part 3: Additional Missing Test Cases (from plan vs implementation)

These were in the plan but not yet implemented:

### From Family 1 (Lifecycle) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_CreateWithAgentId` | Create with agent_id only (no session_id), verify auto-session creation |
| `TestAgentExecution_CreateDefaultAgent` | Create with neither session_id nor agent_id, verify default agent resolution |
| `TestAgentExecution_NonexistentSession` | Non-existent session_id returns NOT_FOUND |
| `TestAgentExecution_RuntimeEnv` | runtime_env values accessible during execution |

### From Family 2 (HITL) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_HITL_PendingApprovalDetails` | Verify pending_approval has correct tool_call_id, tool_name, args_preview, mcp_server_slug |
| `TestAgentExecution_HITL_ApprovalPolicyChain` | 4-level policy chain: McpServerStatus -> McpServerSpec.pinned -> Agent.tool_approval_overrides -> auto_approve_all |
| `TestAgentExecution_HITL_IdempotentApproval` | Submit same approval twice is a no-op |

### From Family 3 (Lifecycle Control) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_PauseTerminalFails` | Pausing COMPLETED execution returns FAILED_PRECONDITION |
| `TestAgentExecution_Recover` | Failed execution -> Recover -> IN_PROGRESS -> resumes from checkpoint |
| `TestAgentExecution_RecoverNonFailedFails` | Recovering non-FAILED execution returns FAILED_PRECONDITION |

### From Family 4 (MCP) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_MCP_HttpToolExecution` | HTTP+SSE MCP server works (same as stdio but different transport) |
| `TestAgentExecution_MCP_ConnectionFailure` | MCP server that fails to start -> execution handles gracefully |
| `TestAgentExecution_MCP_EnvVarResolution` | MCP server args use ${VAR} placeholders resolved from environment |

### From Family 5 (Skills) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_Skill_SessionLevel` | Session skill_refs union'd with agent skills |
| `TestAgentExecution_Skill_Deduplication` | Same skill at agent and session level -> injected once |

### From Family 6 (Sub-Agents) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_SubAgent_McpAccess` | Sub-agent with mcp_access -> only granted MCP tools available |

### From Family 7 (Attachments) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_Attachment_WorkspaceFileRef` | workspace_file_refs -> agent accesses file directly from workspace |

### From Family 8 (Config) — Not Yet Implemented

| Test | What It Proves |
|------|---------------|
| `TestAgentExecution_Config_MaxCostCap` | max_cost_usd set -> execution terminates when cost exceeded |

---

## Part 4: HTTP+SSE Test MCP Server (Not Yet Built)

The plan includes an HTTP+SSE variant of the test MCP server. This is not yet implemented.

**What's needed**:
- `test/integration/harness/mcp_http_server.go` — Go `httptest.Server` implementing MCP JSON-RPC over HTTP
- Shares tool logic with the stdio server
- Used by `TestAgentExecution_MCP_HttpToolExecution`

---

## Execution Priority

### Immediate (Fix Broken Tests)

1. Fix HITL tests — add `ConnectMcpServer` call, improve prompt determinism
2. Fix attachment test — skip when R2 unavailable
3. Fix model override test — use valid model for both harnesses
4. Fix test ordering — lightweight tests first, HITL last

### High Priority (Core Coverage Gaps)

5. Implement remaining lifecycle offline tests (CreateWithAgentId, NonexistentSession, etc.)
6. Implement billing/usage/cost tracking tests
7. Implement HITL PendingApprovalDetails and ApprovalPolicyChain tests

### Medium Priority (Transport + Advanced)

8. Build HTTP+SSE test MCP server
9. Implement MCP ConnectionFailure and EnvVarResolution tests
10. Implement Recover and RecoverNonFailedFails tests

### Lower Priority (Edge Cases)

11. Implement skill session-level and deduplication tests
12. Implement sub-agent MCP access scoping test
13. Implement workspace file ref attachment test

---

## Commands

```bash
# Run all offline integration tests (no API keys)
make test-integration

# Run agent execution tests only (needs ANTHROPIC_API_KEY)
make test-integration-agent

# Run all provider tests including agent execution (needs ANTHROPIC_API_KEY)
make test-integration-providers

# Run a specific test
cd test/integration && go test -tags integration -timeout 300s -run 'TestAgentExecution_HappyPath' -v .

# Build the test MCP server manually
cd test/integration/testdata/mcp-test-server && go build -o /tmp/mcp-test-server .
```

## Key Files to Read

| Area | Path |
|------|------|
| Harness infrastructure | `test/integration/harness/*.go` |
| Test MCP server | `test/integration/testdata/mcp-test-server/main.go` |
| Agent execution tests | `test/integration/agent_execution_*_test.go` |
| Suite setup | `test/integration/suite_test.go` |
| Integration Makefile | `test/integration/Makefile` |
| Agent execution protos | `apis/ai/stigmer/agentic/agentexecution/v1/` |
| Usage/billing protos | `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto` |
| Billing protos | `apis/ai/stigmer/billing/v1/` |
| Session proto | `apis/ai/stigmer/agentic/session/v1/spec.proto` |
| MCP server proto | `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` |
| Plan document | `_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/` (next-task.md) |
