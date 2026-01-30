# HITL Approval Flow - Integration Test Scenarios

This document outlines the integration test scenarios for Phase 5.5 (End-to-End Integration Testing) of the Human-in-the-Loop (HITL) approval flow.

**Created**: 2026-01-30  
**Phase**: 5.5 Preparation  
**Status**: Ready for manual testing

---

## Overview

The HITL approval flow spans three languages and multiple services:
- **Go (workflow-runner)**: Workflow execution with signal handling
- **Java (stigmer-service)**: Agent execution orchestration with Temporal
- **Python (agent-runner)**: Agent execution with LangGraph interrupt/resume

Each test scenario validates the complete flow from user → workflow → agent → tool → approval → resume → completion.

---

## Test Environment Setup

### Prerequisites
1. All services running locally or in staging environment:
   - stigmer-service (Java/Temporal)
   - agent-runner (Python/Temporal)
   - workflow-runner (Go/Temporal)
   - Temporal Server
   - PostgreSQL
   - MongoDB (for checkpointer)

2. Test data:
   - Workflow definition with agent task
   - Agent with MCP tool requiring approval
   - User with edit permissions on workflow/agent

### Port-Forward Commands (Local Testing)
```bash
# If using Kubernetes, port-forward the services
kubectl port-forward svc/stigmer-service 8080:8080
kubectl port-forward svc/temporal-frontend 7233:7233
```

---

## Test Scenarios

### Scenario 1: Approve via Workflow API

**Description**: Submit approval through the WorkflowExecution API and verify complete flow.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create workflow with agent task | Workflow created, PENDING |
| 2 | Start workflow execution | Execution starts, task IN_PROGRESS |
| 3 | Agent calls tool requiring approval | Workflow task enters WORKFLOW_TASK_WAITING_APPROVAL |
| 4 | Verify WorkflowExecution.status.pending_approval | Contains tool_call_id, tool_name, message |
| 5 | Call WorkflowExecution.submitApproval(APPROVE) | Returns updated workflow |
| 6 | Verify agent resumes | Agent execution phase returns to IN_PROGRESS |
| 7 | Wait for agent completion | Agent completes tool execution |
| 8 | Verify workflow completion | Workflow task COMPLETED, workflow COMPLETED |
| 9 | Verify status cleared | Both AgentExecution and WorkflowExecution have cleared pending_approval |

**gRPC Calls**:
```bash
# Step 1: Create workflow execution
grpcurl -plaintext -d '{"spec": {...}}' localhost:8080 ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController/create

# Step 5: Submit approval via workflow
grpcurl -plaintext -d '{
  "execution_id": "wfx_xxx",
  "tool_call_id": "call_xxx",
  "action": "APPROVAL_ACTION_APPROVE",
  "comment": "Integration test - approve"
}' localhost:8080 ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController/submitApproval
```

---

### Scenario 2: Approve via Agent API

**Description**: Submit approval directly to the AgentExecution API and verify workflow detects completion.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create workflow with agent task | Workflow created |
| 2 | Start workflow execution | Agent task starts |
| 3 | Agent enters WAITING_FOR_APPROVAL | Workflow task enters WORKFLOW_TASK_WAITING_APPROVAL |
| 4 | Call AgentExecution.submitApproval(APPROVE) | Agent resumes |
| 5 | Wait for agent completion | Agent completes normally |
| 6 | Verify workflow completion | Workflow task COMPLETED, workflow COMPLETED |
| 7 | Verify workflow status cleared | WorkflowExecution.pending_approval cleared |

**gRPC Calls**:
```bash
# Step 4: Submit approval directly to agent
grpcurl -plaintext -d '{
  "agent_execution_id": "aex_xxx",
  "tool_call_id": "call_xxx",
  "action": "APPROVAL_ACTION_APPROVE"
}' localhost:8080 ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/submitApproval
```

---

### Scenario 3: Skip via Workflow API

**Description**: Submit SKIP action and verify tool is skipped without execution.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start workflow with agent task | Agent reaches tool requiring approval |
| 2 | Verify pending_approval | tool_call_id, tool_name populated |
| 3 | Call WorkflowExecution.submitApproval(SKIP) | Returns updated workflow |
| 4 | Verify tool status | Tool marked TOOL_CALL_SKIPPED |
| 5 | Verify agent continues | Agent receives "Tool skipped by user" message |
| 6 | Verify workflow completion | Workflow completes (not failed) |
| 7 | Verify LLM response | LLM acknowledged the skip and continued |

**Expected Tool Call Status**:
```json
{
  "id": "call_xxx",
  "name": "delete_repository",
  "status": "TOOL_CALL_SKIPPED",
  "approval_action": "APPROVAL_ACTION_SKIP",
  "result": "Tool execution skipped by user"
}
```

---

### Scenario 4: Reject via Workflow API

**Description**: Submit REJECT action and verify workflow fails appropriately.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start workflow with agent task | Agent reaches tool requiring approval |
| 2 | Call WorkflowExecution.submitApproval(REJECT) | Returns workflow |
| 3 | Verify tool status | Tool marked TOOL_CALL_FAILED |
| 4 | Verify agent status | Agent execution EXECUTION_FAILED |
| 5 | Verify workflow task status | Task enters WORKFLOW_TASK_FAILED |
| 6 | Verify workflow status | Workflow enters EXECUTION_FAILED |
| 7 | Verify error message | Contains "rejected" information |

**Expected Agent Status**:
```json
{
  "phase": "EXECUTION_FAILED",
  "error": "Tool execution rejected by user: User rejected the operation"
}
```

---

### Scenario 5: Multiple Agents in Workflow

**Description**: Workflow with multiple agent tasks, second agent requires approval.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create workflow: task1 (no approval) → task2 (approval required) → task3 | Workflow created |
| 2 | Start execution | Task1 starts |
| 3 | Wait for task1 completion | Task1 COMPLETED |
| 4 | Task2 starts, requires approval | Task2 enters WAITING_APPROVAL |
| 5 | Verify only task2 waiting | Task1 COMPLETED, task2 WAITING, task3 PENDING |
| 6 | Submit approval for task2 | Task2 resumes |
| 7 | Wait for completion | All tasks COMPLETED |
| 8 | Verify final status | Workflow COMPLETED |

**Workflow Definition (YAML)**:
```yaml
tasks:
  - call: agent
    name: research_task
    with:
      agent: research-agent
      message: "Research the topic"
  
  - call: agent
    name: dangerous_task
    with:
      agent: delete-agent  # Has tools requiring approval
      message: "Clean up old repos"
  
  - call: agent
    name: summary_task
    with:
      agent: summary-agent
      message: "Summarize the results"
```

---

### Scenario 6: Approval Timeout

**Description**: Verify behavior when approval is not submitted within timeout.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start workflow with agent task | Agent reaches approval point |
| 2 | Do NOT submit approval | Wait for activity timeout |
| 3 | Verify timeout error | Agent fails with timeout error |
| 4 | Verify workflow task status | Task WORKFLOW_TASK_FAILED |
| 5 | Verify error message | Contains timeout information |

**Note**: Activity timeout is configured in `InvokeAgentExecutionWorkflowImpl.java` - default is 10 minutes for executeGraphton activity.

---

### Scenario 7: Signal Latency Verification

**Description**: Verify sub-100ms signal propagation from child to parent.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start workflow with agent task | Workflow running |
| 2 | Agent enters WAITING_FOR_APPROVAL | Record timestamp T1 |
| 3 | Check WorkflowExecution.pending_approval | Record timestamp T2 when populated |
| 4 | Calculate latency: T2 - T1 | Should be < 100ms (typically < 50ms) |

**Measurement Points**:
- T1: Java workflow logs "Notifying parent workflow of approval requirement"
- T2: WorkflowExecution.status.pending_approval.requested_at

---

## Verification Checklist

After running all scenarios, verify:

- [ ] All approval actions work correctly (APPROVE, SKIP, REJECT)
- [ ] Both submission paths work (Workflow API and Agent API)
- [ ] Status is cleared at all levels after approval resolution
- [ ] Multiple agents in workflow handled correctly
- [ ] Signal latency is sub-100ms
- [ ] Error messages are clear and actionable
- [ ] Audit logs contain all approval decisions
- [ ] No orphaned pending_approval states

---

## Known Limitations

1. **Timeout handling**: If approval is not submitted before activity timeout, the execution fails. Consider adding a longer timeout or implementing approval expiration.

2. **Concurrent approvals**: Only one tool can be pending approval at a time per agent execution. Sequential approval for multiple tools is supported.

3. **Sub-agent nesting**: Sub-agent approvals propagate to the main agent, which then propagates to the parent workflow. Deep nesting (>3 levels) may have higher latency.

---

## Troubleshooting

### Issue: Approval signal not received
**Symptoms**: Workflow task stays in WAITING_APPROVAL after approval submitted
**Check**:
1. Verify Temporal workflow is running (Temporal UI)
2. Check Java logs for signal sending errors
3. Check Go logs for signal receiving errors
4. Verify `parent_workflow_id` is set on AgentExecution

### Issue: pending_approval not cleared
**Symptoms**: Stale pending_approval after workflow completes
**Check**:
1. Check Python logs for `clear_pending_approval()` calls
2. Check Java logs for defensive validation warnings
3. Check Go logs for `ClearWorkflowApprovalStatus` activity execution

### Issue: High signal latency
**Symptoms**: > 100ms between agent approval and workflow update
**Check**:
1. Network latency between services
2. Temporal activity execution time
3. Database write performance for status updates

---

## Related Documentation

- [Phase 5 Plan](.cursor/plans/hitl_phase_5_workflow_integration.plan.md)
- [Phase 5.4 Plan](.cursor/plans/hitl_phase_5.4_approval_resumption_d6b4558c.plan.md)
- [ADR: Async Agent Execution Token Handshake](docs/adr/20260122-async-agent-execution-temporal-token-handshake.md)
