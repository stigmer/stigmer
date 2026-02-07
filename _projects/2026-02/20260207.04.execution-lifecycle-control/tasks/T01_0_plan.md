# Task T01: Execution Lifecycle Control - Design and Implementation Plan

**Created**: 2026-02-07
**Status**: PENDING REVIEW
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

---

## Executive Summary

The landing page messaging claims "durable workflows" with "retry and resume" capabilities, but the current user-facing APIs don't support these features. This project adds user-facing lifecycle control RPCs for workflow and agent executions:

| Capability | Current State | Target State |
|------------|---------------|--------------|
| Cancel running execution | ❌ Internal only (WorkflowRunner) | ✅ User-facing API + CLI |
| Retry failed execution | ❌ Manual workaround only | ✅ `retry` RPC + CLI command |
| Pause/Resume execution | ❌ Internal only + no PAUSED phase | ✅ Phase enum + API + CLI |
| Retry from specific task | ❌ Not supported | ⚡ Future enhancement |

---

## Research Findings

### What EXISTS Today

**Internal WorkflowRunner Interface** (`apis/ai/stigmer/agentic/workflowrunner/v1/interface.proto`):
```protobuf
rpc cancelExecution(CancelExecutionRequest) returns (google.protobuf.Empty);
rpc pauseExecution(PauseExecutionRequest) returns (google.protobuf.Empty);
rpc resumeExecution(ResumeExecutionRequest) returns (google.protobuf.Empty);
```

**User-Facing APIs** (WorkflowExecutionCommandController):
- `create` - Create and trigger execution
- `update` - Update execution configuration
- `updateStatus` - For workflow runner (internal)
- `submitApproval` - For HITL flows
- `delete` - Delete execution

**Phase Enum** (ExecutionPhase):
- `EXECUTION_PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLED`
- ❌ Missing: `EXECUTION_PAUSED`

**Manual Retry Workaround** (from query.proto comments):
```
// 4. Retry Failed Execution:
// - User calls get() to retrieve failed execution's spec
// - User creates new execution with same spec values
```

### The Gap

| Landing Page Claim | Reality |
|--------------------|---------|
| "Workflows keep state and resume after failures" | No user-facing resume API |
| "Chain specialists, branch, retry, and resume" | No retry API |
| "Workflows that don't lose state" | True at Temporal level, but users can't leverage it |

---

## Implementation Plan

### Phase 1: Protocol Buffers (Proto API Design)

**1.1 Add EXECUTION_PAUSED phase enum**

File: `apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto`

```protobuf
enum ExecutionPhase {
  // ... existing phases ...
  
  // Execution is paused and can be resumed.
  //
  // The workflow runner has checkpointed state and released resources.
  // Resume via WorkflowExecutionCommandController.resume() to continue.
  //
  // Use Cases:
  // - Cost optimization: Pause development workflows overnight
  // - Manual intervention: Pause for external approval or data
  // - Resource management: Pause low-priority workflows
  //
  // Next phases: EXECUTION_IN_PROGRESS (on resume), EXECUTION_CANCELLED
  EXECUTION_PAUSED = 6;
}
```

**1.2 Add lifecycle RPCs to WorkflowExecutionCommandController**

File: `apis/ai/stigmer/agentic/workflowexecution/v1/command.proto`

```protobuf
// Cancel a running or pending workflow execution.
rpc cancel(CancelWorkflowExecutionInput) returns (WorkflowExecution);

// Retry a failed workflow execution with same inputs.
rpc retry(RetryWorkflowExecutionInput) returns (WorkflowExecution);

// Pause a running workflow execution.
rpc pause(PauseWorkflowExecutionInput) returns (WorkflowExecution);

// Resume a paused workflow execution.
rpc resume(ResumeWorkflowExecutionInput) returns (WorkflowExecution);
```

**1.3 Add IO messages**

File: `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto`

```protobuf
message CancelWorkflowExecutionInput {
  string execution_id = 1;
  string reason = 2;      // Optional: why cancelling
  bool force = 3;         // If true, don't wait for in-flight tasks
}

message RetryWorkflowExecutionInput {
  string execution_id = 1;           // Failed execution to retry
  map<string, ExecutionValue> runtime_env_overrides = 2; // Optional overrides
}

message PauseWorkflowExecutionInput {
  string execution_id = 1;
  string reason = 2;
}

message ResumeWorkflowExecutionInput {
  string execution_id = 1;
  string reason = 2;
}
```

**1.4 Mirror for AgentExecution**

Same pattern for `apis/ai/stigmer/agentic/agentexecution/v1/`:
- Add `EXECUTION_PAUSED` to AgentExecution enum
- Add `cancel`, `retry` RPCs (pause/resume may not apply to agents)

---

### Phase 2: Backend Handlers

**2.1 WorkflowExecution handlers**

Location: `services/agentic/internal/handler/workflowexecution/`

| RPC | Handler Logic |
|-----|--------------|
| `cancel` | Validate phase is cancellable → Call WorkflowRunner.cancelExecution → Update status |
| `retry` | Validate phase is FAILED → Copy spec from old execution → Create new execution |
| `pause` | Validate phase is IN_PROGRESS → Call WorkflowRunner.pauseExecution → Update phase to PAUSED |
| `resume` | Validate phase is PAUSED → Call WorkflowRunner.resumeExecution → Update phase to IN_PROGRESS |

**2.2 Authorization**

Each RPC needs permission checks:
- `cancel`: Requires `can_edit` on the execution
- `retry`: Requires `can_create_execution_in` on the workflow instance (same as create)
- `pause`/`resume`: Requires `can_edit` on the execution

---

### Phase 3: CLI Commands

**3.1 Workflow commands**

```bash
# Cancel a running workflow
stigmer workflow cancel <execution-id> [--reason "..."] [--force]

# Retry a failed workflow
stigmer workflow retry <execution-id>

# Pause a running workflow
stigmer workflow pause <execution-id> [--reason "..."]

# Resume a paused workflow
stigmer workflow resume <execution-id>
```

**3.2 Agent commands**

```bash
# Cancel a running agent
stigmer agent cancel <execution-id> [--reason "..."]

# Retry a failed agent
stigmer agent retry <execution-id>
```

**3.3 Implementation files**

Create new command files:
- `client-apps/cli/cmd/stigmer/root/workflow_cancel.go`
- `client-apps/cli/cmd/stigmer/root/workflow_retry.go`
- `client-apps/cli/cmd/stigmer/root/workflow_pause.go`
- `client-apps/cli/cmd/stigmer/root/workflow_resume.go`
- `client-apps/cli/cmd/stigmer/root/agent_cancel.go`
- `client-apps/cli/cmd/stigmer/root/agent_retry.go`

---

### Phase 4: WebSocket Events

**4.1 Add new event types**

File: `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto`

```protobuf
enum WorkflowExecutionUpdateType {
  // ... existing ...
  wf_update_execution_paused = 7;
  wf_update_execution_resumed = 8;
}
```

---

### Phase 5: Testing

**5.1 Unit tests**
- Handler tests for each new RPC
- CLI command tests

**5.2 Integration tests**
- End-to-end cancel flow
- End-to-end retry flow
- Pause/resume cycle

**5.3 Temporal integration tests**
- Verify cancel propagates to Temporal
- Verify pause checkpoints correctly
- Verify resume restores state

---

## Files to Modify/Create

| File | Action | Phase |
|------|--------|-------|
| `apis/.../workflowexecution/v1/enum.proto` | Modify (add PAUSED) | 1 |
| `apis/.../workflowexecution/v1/command.proto` | Modify (add RPCs) | 1 |
| `apis/.../workflowexecution/v1/io.proto` | Modify (add messages) | 1 |
| `apis/.../agentexecution/v1/enum.proto` | Modify (add PAUSED) | 1 |
| `apis/.../agentexecution/v1/command.proto` | Modify (add RPCs) | 1 |
| `apis/.../agentexecution/v1/io.proto` | Modify (add messages) | 1 |
| `services/agentic/.../workflowexecution/*.go` | Modify (add handlers) | 2 |
| `services/agentic/.../agentexecution/*.go` | Modify (add handlers) | 2 |
| **NEW** `cli/.../workflow_cancel.go` | Create | 3 |
| **NEW** `cli/.../workflow_retry.go` | Create | 3 |
| **NEW** `cli/.../workflow_pause.go` | Create | 3 |
| **NEW** `cli/.../workflow_resume.go` | Create | 3 |
| **NEW** `cli/.../agent_cancel.go` | Create | 3 |
| **NEW** `cli/.../agent_retry.go` | Create | 3 |

---

## Success Criteria

From project goals:
- [x] Research complete - gap identified
- [ ] Users can cancel running executions via API/CLI
- [ ] Users can retry failed executions via API/CLI
- [ ] EXECUTION_PAUSED phase exists and works
- [ ] CLI has cancel/retry subcommands for agent/workflow
- [ ] Retry preserves original spec but creates new execution ID
- [ ] WebSocket events for pause/resume

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Temporal integration complexity for pause/resume | Start with cancel and retry (simpler); pause/resume in Phase 2 |
| Race conditions between cancel and status updates | Use optimistic locking on phase transitions |
| Retry from specific task requires workflow definition changes | Defer to future enhancement; start with full retry |

---

## Recommended Execution Order

**High Priority (Core Durability Promise):**
1. **T01** (This plan) - Design review and approval
2. **T02** - Proto: Add `cancel` and `retry` RPCs + messages
3. **T03** - Backend: Implement `cancel` and `retry` handlers
4. **T04** - CLI: Add `cancel` and `retry` commands
5. **T05** - Testing: Unit + integration tests

**Medium Priority (Full Lifecycle Control):**
6. **T06** - Proto: Add `EXECUTION_PAUSED` phase + `pause`/`resume` RPCs
7. **T07** - Backend: Implement `pause` and `resume` handlers
8. **T08** - CLI: Add `pause` and `resume` commands

**Low Priority (Future Enhancement):**
- Retry from specific failed task
- Retry policies in workflow spec

---

## Review Process

**What happens next:**
1. **You review this plan** - Consider the phasing and approach
2. **Provide feedback** - Any changes to scope, priorities, or design
3. **I'll revise if needed** - Update based on your input
4. **You approve** - Explicit approval to proceed
5. **Execution begins** - Start with T02 (Proto changes)

**Please consider:**
- Should we include pause/resume in MVP, or defer?
- Do we need retry from a specific task, or is full retry sufficient?
- Any concerns about the cancel behavior (graceful vs forced)?
- Naming preferences for CLI commands?
