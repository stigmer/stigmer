# Remaining Integration Test Failures (Provider-Backed Suite)

**Date**: May 16, 2026
**Context**: After implementing cancel/terminate handlers, MinIO testcontainer, and HITL/MCP test improvements.
**Test command**: `make test-integration-providers` (auto-fetches Anthropic + Cursor keys from Planton)
**Latest result**: 73 tests, 21 failures (down from 27 failures before fixes)

## What Was Fixed This Session

| Fix | Impact |
|-----|--------|
| `AgentExecutionCancelHandler` + `AgentExecutionTerminateHandler` in stigmer-cloud | Cancel, CancelIdempotent, SubAgent_ParentCancelCascade now pass (6 tests) |
| MinIO testcontainer + bucket creation in harness | Skill push and attachment upload no longer get "connection refused" or "bucket not found" |
| `BuildMcpServerStigmer` path fix (4 `..` → 3) | Workflow Architect tests can now build the mcp-server-stigmer binary |
| HTTP MCP test: stronger prompts + async discovery delay | MCP_HttpToolExecution/cursor now passes |
| HITL tests: explicit `enabledTools`, stronger instructions, diagnostic logging | Better diagnostics on failure; reduced flake surface |

## Remaining Failures

### 1. Skill_AgentLevel — Message assertion failure (both harnesses)

**Error**: `expected message types [MESSAGE_HUMAN MESSAGE_AI] in order; found 0 of 2 in 1 messages`

**File**: `test/integration/agent_execution_04_skills_test.go:51`

**What happens**: The skill push now succeeds (MinIO is working). The agent creates and execution completes. But the assertion expects 2 messages (human + AI) and only finds 1. The response message type ordering doesn't match expectations.

**Likely cause**: The skill content may not be reaching the agent's system prompt correctly, or the message type classification for skill-augmented responses differs from what the assertion expects. Check how `AssertMessageTypes` matches against `msg.GetType()` and whether the execution's messages include the human prompt.

**Relevant files**:
- `test/integration/agent_execution_04_skills_test.go`
- `test/integration/agent_execution_helpers_test.go` (createTestSkill)
- `test/integration/harness/agent_execution_waiter.go` (AssertMessageTypes)

---

### 2. Pause_Resume — Resume fails on EXECUTION_FAILED (both harnesses)

**Error**: `Cannot resume agent execution in EXECUTION_FAILED phase. Only PAUSED executions can be resumed.`

**File**: `test/integration/agent_execution_06_lifecycle_control_test.go`

**What happens**: The test sends a pause signal, then tries to resume. By the time resume is called, the execution is in EXECUTION_FAILED instead of EXECUTION_PAUSED. The pause signal causes the activity to fail rather than cleanly save a checkpoint.

**Likely cause**: The agent-runner's pause signal handler may not be saving a LangGraph checkpoint correctly, or the Python activity is raising an exception when cancelled instead of gracefully pausing. This is a runner-side behavior issue.

**Relevant files**:
- `test/integration/agent_execution_06_lifecycle_control_test.go` (Pause_Resume test)
- `backend/services/agent-runner/src/stigmer_runner/worker/activities/graphton/` (pause signal handling)
- Handler: `AgentExecutionPauseHandler.java` → sends `SIGNAL_PAUSE` to Temporal
- Handler: `AgentExecutionResumeHandler.java` → sends `SIGNAL_RESUME` to Temporal

---

### 3. Terminate/cursor — Race condition

**Error**: `agent execution reached terminal phase EXECUTION_COMPLETED instead of expected EXECUTION_TERMINATED`

**File**: `test/integration/agent_execution_06_lifecycle_control_test.go`

**What happens**: The execution completes before the terminate call reaches it. Terminate/native passes, but cursor harness has higher latency.

**Likely cause**: The test creates an execution and immediately calls terminate, but with Cursor's API latency, the execution finishes (COMPLETED) before the terminate signal arrives. The test needs a longer-running execution prompt or a wait-for-IN_PROGRESS step before calling terminate.

**Relevant files**:
- `test/integration/agent_execution_06_lifecycle_control_test.go` (Terminate test)

---

### 4. Attachment_Upload/native — Execution fails

**Error**: `agent execution reached terminal phase EXECUTION_FAILED instead of expected EXECUTION_COMPLETED`

**File**: `test/integration/agent_execution_07_attachments_test.go`

**What happens**: Attachment upload succeeds (MinIO is working now), but the subsequent execution fails. The cursor harness passes.

**Likely cause**: The native (Python agent-runner) harness may handle attachment references differently than cursor, or the attachment content isn't being passed to the LLM correctly in the native runner's execution flow.

**Relevant files**:
- `test/integration/agent_execution_07_attachments_test.go`
- `backend/services/agent-runner/` (attachment handling in graphton)

---

### 5. HITL_Approve, HITL_Skip, HITL_Reject — LLM non-determinism (both harnesses)

**Errors**:
- `agent execution reached terminal phase EXECUTION_COMPLETED instead of expected EXECUTION_WAITING_FOR_APPROVAL` (LLM skipped tool call)
- `timed out waiting for agent execution to reach phase EXECUTION_COMPLETED after 2m` (stuck after approval)

**Files**: `test/integration/agent_execution_08_hitl_test.go`

**What happens**: The HITL tests depend on the LLM calling the `echo` MCP tool (which has `RequiresApproval: true`). When the LLM responds with text instead of calling the tool, the execution completes without ever hitting the approval gate.

**Current mitigations already applied**:
- Strong instructions: "You MUST call the echo tool. Never respond with text only."
- Explicit `enabledTools: "echo"` in `WithMcpServerUsageAndApproval`
- `LogExecutionMessages` diagnostic on failure

**Possible further improvements**:
1. Use a deterministic test double instead of a real LLM for HITL gate testing
2. Add a retry loop: if `WaitForApproval` fails with early-terminal COMPLETED, create a fresh execution and retry once
3. Use `tool_choice: required` or equivalent if the API supports forcing tool use
4. Separate the HITL gate mechanism test (deterministic, uses mocked tool calls) from the E2E LLM test

**Relevant files**:
- `test/integration/agent_execution_08_hitl_test.go`
- `test/integration/harness/agent_factory.go` (WithMcpServerUsageAndApproval)
- `backend/services/agent-runner/src/stigmer_runner/worker/activities/graphton/handlers/tool_event.py` (approval gate)
- `backend/services/agent-runner/src/stigmer_runner/worker/activities/graphton/approval_policy.py` (policy chain)

---

### 6. MCP_HttpToolExecution/native — LLM non-determinism

**Error**: `expected tool call "echo" not found in execution messages`

**File**: `test/integration/agent_execution_03_mcp_test.go`

**What happens**: The cursor harness passes, but native fails. The LLM on the native harness completes without calling the echo tool.

**Note**: The `ConnectMcpServer` approach doesn't work for HTTP MCP servers because the httptest server is in-process and unreachable from the agent-runner's Temporal connect workflow. A 3-second sleep is used instead for async discovery. The native harness may need a longer delay, or the prompt can be further strengthened.

**Relevant files**:
- `test/integration/agent_execution_03_mcp_test.go` (TestAgentExecution_MCP_HttpToolExecution)
- `test/integration/harness/mcp_http_server.go` (StartHTTPMcpServer)

---

## Summary Table

| Test | Harness | Error Category | Priority |
|------|---------|---------------|----------|
| Skill_AgentLevel | Both | Message assertion / skill content delivery | High |
| Pause_Resume | Both | Runner pause signal handling | High |
| Terminate | Cursor | Race condition (fast completion) | Medium |
| Attachment_Upload | Native | Execution fails with attachment | Medium |
| HITL_Approve | Both | LLM non-determinism / approval gate | Medium |
| HITL_Skip | Both | LLM non-determinism / approval gate | Medium |
| HITL_Reject | Both | LLM non-determinism / approval gate | Medium |
| MCP_HttpToolExecution | Native | LLM non-determinism / async discovery | Low |

## How to Reproduce

```bash
# From stigmer repo root (stigmer-cloud must be a sibling with JAR built):
make test-integration-providers

# Run a specific failing test:
cd test/integration
ANTHROPIC_API_KEY=<key> CURSOR_API_KEY=<key> STIGMER_SERVICE_JAR=<jar-path> \
  gotestsum --format testname -- -tags integration -timeout 900s -count=1 \
  -run 'TestAgentExecution_Pause_Resume' ./...
```
