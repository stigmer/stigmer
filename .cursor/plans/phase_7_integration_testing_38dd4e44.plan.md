---
name: Phase 7 Integration Testing
overview: Comprehensive end-to-end integration testing for the HITL approval flow, covering execution of existing tests, implementation of missing scenarios (auto_approve_all, sub-agent propagation, platform tools), and production validation.
todos:
  - id: phase-7.0-sdk
    content: "BLOCKER: Complete SDK changes (add AutoApproveAll to AgentExecutionConfig, tool approval overrides)"
    status: pending
  - id: phase-7.1-validate
    content: "Phase 7.1: Run and validate existing 22 E2E tests against live infrastructure"
    status: pending
  - id: phase-7.2-auto-approve
    content: "Phase 7.2: Implement auto_approve_all mode tests (4 tests, requires SDK example)"
    status: pending
  - id: phase-7.3-platform-tools
    content: "Phase 7.3: Implement platform tool approval defaults tests (9 tests, 1 fixture)"
    status: pending
  - id: phase-7.4-subagent
    content: "Phase 7.4: Implement sub-agent approval propagation tests (5 tests, use existing 04_agent_with_subagents.go)"
    status: pending
  - id: phase-7.5-final
    content: "Phase 7.5: Final validation - run full suite (40 tests), document results, update docs"
    status: pending
isProject: false
---

# Phase 7: HITL Approval Flow Integration Testing

## BLOCKER: SDK Changes Required

**Phase 7 is BLOCKED until SDK changes are complete.**

### SDK Changes Needed

1. **Add `AutoApproveAll` to `AgentExecutionConfig`**
   ```go
   type AgentExecutionConfig struct {
       Model          string  `json:"model,omitempty"`
       Temperature    float64 `json:"temperature,omitempty"`
       Timeout        int     `json:"timeout,omitempty"`
       AutoApproveAll bool    `json:"auto_approve_all,omitempty"`  // NEW
   }
   ```

2. **Update `sdk/go/workflow/proto.go`** to serialize the new field

3. **Create SDK example** `sdk/go/examples/20_agent_with_approval_config.go`

4. **Optional**: Add tool approval override support to `McpServerUsage`

### Files to Modify
- `sdk/go/gen/types/agentic_types.go` or wherever `AgentExecutionConfig` is defined
- `sdk/go/workflow/proto.go` - Add serialization for `auto_approve_all`
- `sdk/go/examples/20_agent_with_approval_config.go` - New example (test fixture)

---

## Executive Summary

Phase 5.5 created the E2E test infrastructure with 22 test functions across 6 scenarios. Phase 7 completes the integration testing by:

1. Executing existing tests against live infrastructure
2. Implementing 3 missing test scenarios identified as gaps
3. Validating production readiness with comprehensive coverage

## Current State Analysis

### What Exists (Phase 5.5 Output)

| Component | Status | Lines |
|-----------|--------|-------|
| `approval_test_constants.go` | Complete | ~90 |
| `approval_test_helpers.go` | Complete | ~450 |
| 6 test files (22 tests) | Implemented | ~890 |
| Test fixtures | Partial | ~120 |

### Critical Gaps Identified

1. **auto_approve_all Mode** - Zero test coverage (REQUIRES SDK CHANGES)
2. **Sub-Agent Approval Propagation** - Zero test coverage
3. **Platform Tool Defaults** - Zero test coverage
4. **Test Execution** - Tests written but not validated against live system

---

## Part 1: Test Infrastructure Validation

### 1.1 Prerequisites Verification

Before running tests, verify infrastructure:

```bash
# Verify all services are running
stigmer server status
temporal server status
ollama list  # Verify qwen2.5-coder:7b or equivalent
```

### 1.2 Execute Existing Test Suite

Run the 22 existing tests and document results:

```bash
go test -tags=e2e -v -timeout 15m -run "TestHitlApproval" ./test/e2e/...
```

Expected: All 22 tests pass. Any failures require investigation and fixes.

---

## Part 2: Missing Test Scenarios

### 2.1 Scenario 8: auto_approve_all Mode (NEW - REQUIRES SDK)

**Purpose**: Verify that `auto_approve_all=true` bypasses ALL approval requirements.

**Dependency**: SDK must expose `AutoApproveAll` field in `AgentExecutionConfig`

**Test Cases**:

| Test | Description |
|------|-------------|
| `TestHitlAutoApproveAllBypassesMcpToolApproval` | MCP tool with approval policy executes without pause |
| `TestHitlAutoApproveAllBypassesPlatformToolApproval` | Platform write/edit/execute tools execute without pause |
| `TestHitlAutoApproveAllInWorkflowContext` | Workflow with auto_approve_all agent completes without approval wait |
| `TestHitlAutoApproveAllVsExplicitApproval` | Compare execution flow with/without auto_approve_all |

**Implementation Approach**:

1. Create new SDK example: `sdk/go/examples/20_agent_with_approval_config.go`
   - Workflow with agent task using `AutoApproveAll: true`
   - Same MCP server with approval-required tools
2. Create test file: `hitl_approval_auto_approve_test.go`

**Key Verification Points**:
- Agent never enters `EXECUTION_WAITING_FOR_APPROVAL` phase
- Tool calls go directly to `TOOL_CALL_RUNNING` (skip `WAITING_APPROVAL`)
- `pending_approval` field is never populated
- Workflow task never enters `WORKFLOW_TASK_WAITING_APPROVAL`
- Execution completes successfully

---

### 2.2 Scenario 9: Sub-Agent Approval Propagation (NEW)

**Purpose**: Verify approval requests from nested sub-agents surface correctly to the main agent and parent workflow.

**Dependency**: Can use existing `04_agent_with_subagents.go` example

**Test Cases**:

| Test | Description |
|------|-------------|
| `TestHitlSubAgentApprovalSurfacesToMainAgent` | Sub-agent approval visible in main agent's pending_approval |
| `TestHitlSubAgentApprovalSurfacesToWorkflow` | Sub-agent approval visible at workflow level with child_agent_execution_id |
| `TestHitlSubAgentApprovalFromSubAgentField` | Verify `from_sub_agent=true` and `sub_agent_name` populated |
| `TestHitlSubAgentApprovalSubmitViaMainAgent` | Submit approval via main agent API works |
| `TestHitlSubAgentApprovalSubmitViaWorkflow` | Submit approval via workflow API works |

**Key Verification Points**:
- `pending_approval.from_sub_agent == true`
- `pending_approval.sub_agent_name` matches the sub-agent name
- Approval submission at any level (sub-agent, main agent, workflow) works
- Signal latency from sub-agent to workflow < 200ms (longer due to extra hop)

---

### 2.3 Scenario 10: Platform Tool Approval Defaults (NEW)

**Purpose**: Verify hardcoded platform tool defaults work correctly (read/ls/glob/grep = no approval, write/edit/execute = approval required).

**Test Cases**:

| Test | Description |
|------|-------------|
| `TestHitlPlatformToolReadNoApproval` | `read` tool executes without approval |
| `TestHitlPlatformToolLsNoApproval` | `ls` tool executes without approval |
| `TestHitlPlatformToolGlobNoApproval` | `glob` tool executes without approval |
| `TestHitlPlatformToolGrepNoApproval` | `grep` tool executes without approval |
| `TestHitlPlatformToolWriteRequiresApproval` | `write` tool requires approval |
| `TestHitlPlatformToolEditRequiresApproval` | `edit` tool requires approval |
| `TestHitlPlatformToolExecuteRequiresApproval` | `execute` tool requires approval |
| `TestHitlPlatformToolApprovalMessageTemplate` | Message template renders correctly with args |
| `TestHitlPlatformToolAutoApproveAllBypass` | `auto_approve_all` bypasses platform tool approval |

**Platform Tool Defaults Reference** from `approval_policy.py`:

```python
PLATFORM_TOOL_DEFAULTS = {
    "read": {"requires_approval": False},
    "ls": {"requires_approval": False},
    "glob": {"requires_approval": False},
    "grep": {"requires_approval": False},
    "write": {"requires_approval": True, "message": "Write file: {{args.path}}"},
    "edit": {"requires_approval": True, "message": "Edit file: {{args.path}}"},
    "execute": {"requires_approval": True, "message": "Execute command: {{args.command}}"},
}
```

---

## Part 3: Test File Organization

### New Files to Create (After SDK Changes)

```
sdk/go/examples/
└── 20_agent_with_approval_config.go     (NEW - SDK example for auto_approve_all)

test/e2e/
├── hitl_approval_auto_approve_test.go       (NEW - ~200 lines, 4 tests)
├── hitl_approval_subagent_test.go           (NEW - ~300 lines, 5 tests)
└── hitl_approval_platform_tools_test.go     (NEW - ~350 lines, 9 tests)
```

### Estimated Changes

| Category | Files | Lines Added |
|----------|-------|-------------|
| SDK Example | 1 new | ~100 |
| Test Files | 3 new | ~850 |
| Constants | 1 modified | ~30 |
| Helpers | 1 modified | ~100 |
| **Total** | **6 files** | **~1,080 lines** |

---

## Part 4: Implementation Order

### Phase 7.0: SDK Changes (BLOCKER - User to Complete)

1. Add `AutoApproveAll` to `AgentExecutionConfig`
2. Update proto serialization
3. Create SDK example `20_agent_with_approval_config.go`

### Phase 7.1: Validate Existing Tests

1. Verify infrastructure prerequisites
2. Run existing 22 tests
3. Document any failures
4. Fix issues found (if any)
5. Establish baseline metrics (latency, timing)

### Phase 7.2: auto_approve_all Tests (After SDK Changes)

1. Use new SDK example as fixture
2. Add constants and helpers
3. Implement 4 test cases
4. Run and validate

### Phase 7.3: Platform Tool Tests

1. Create agent fixture with sandbox tools
2. Implement 9 test cases (safe tools + dangerous tools)
3. Run and validate
4. Verify message template rendering

### Phase 7.4: Sub-Agent Tests

1. Use existing `04_agent_with_subagents.go` as base
2. Add MCP server with approval policies
3. Add sub-agent specific helpers
4. Implement 5 test cases
5. Verify signal propagation latency

### Phase 7.5: Final Validation

1. Run complete test suite (22 existing + 18 new = 40 tests)
2. Document results
3. Update integration-test-scenarios.md
4. Clean up any technical debt

---

## Part 5: Quality Standards

### Engineering Standards Adherence

Per the established Stigmer CLI engineering standards:

- All test files < 250 lines (split if larger)
- All test functions < 50 lines (use helpers)
- Clear naming: `TestHitl[Scenario][Variation]`
- Comprehensive error messages with context
- No flaky tests (use proper timeouts and retries)

### Performance Requirements

| Metric | Threshold |
|--------|-----------|
| Signal latency (agent → workflow) | < 100ms |
| Signal latency (sub-agent → workflow) | < 200ms |
| Test execution time (single test) | < 60s |
| Full suite execution time | < 15min |

---

## Part 6: Success Criteria

### Minimum Acceptance Criteria

- [ ] SDK changes complete (AutoApproveAll exposed)
- [ ] All 22 existing tests pass against live infrastructure
- [ ] 4 new auto_approve_all tests pass
- [ ] 9 new platform tool tests pass
- [ ] 5 new sub-agent tests pass
- [ ] Signal latency within thresholds
- [ ] No flaky tests (3 consecutive green runs)

### Documentation Deliverables

- [ ] Updated `integration-test-scenarios.md` with Scenarios 8-10
- [ ] Test results documented in checkpoint file
- [ ] Any issues discovered and their resolutions
