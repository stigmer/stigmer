---
name: ""
overview: ""
todos: []
isProject: false
---

# Phase 5: Workflow Integration - HITL Approval Flow

**Created**: 2026-01-30
**Status**: PLANNING
**Complexity**: HIGH - Involves polyglot coordination (Go ↔ Java), async patterns, and multi-layer state propagation

---

## Executive Summary

Phase 5 implements approval flow propagation from child agent executions to parent workflow executions. When a workflow invokes an agent that requires tool approval, the approval request surfaces at the workflow level, allowing users to submit approvals through either the agent or workflow API.

**Core Challenge**: Bridge the async gap between workflow execution (Go/Temporal) and agent execution (Java/Python) to detect and propagate approval states.

---

## Architectural Context

### Current State (After Phase 4)

- ✅ Agent-level HITL approval flow complete (Proto, Python, Java)
- ✅ Direct agent invocation approval working
- ✅ Sub-agent approval propagation working
- ❌ Workflow → Agent approval propagation NOT implemented

### Target Architecture

```
User → Workflow → Agent → Tool (requiring approval)
   ↑                ↑
   │                │ Agent enters EXECUTION_WAITING_FOR_APPROVAL
   │                │ Tool shows TOOL_CALL_WAITING_APPROVAL
   │                │
   │                ▼ Workflow detects child state
   │    Workflow Task enters WORKFLOW_TASK_WAITING_APPROVAL
   │    WorkflowExecution.pending_approval populated
   │
   └─── User submits approval via Workflow or Agent API
```

### Key Technical Constraints

1. **Async Completion Pattern**: Agent executions use Temporal async completion (token handshake)
  - CallAgentActivity returns `ErrResultPending` immediately
  - Agent completes asynchronously via callback_token
  - Workflow is paused at the activity invocation point
2. **Polyglot Architecture**:
  - Workflow orchestration: Go (workflow-runner)
  - Agent orchestration: Java (stigmer-service Temporal workflows)
  - Agent execution: Python (agent-runner LangGraph)
3. **State Propagation**: Approval state must flow:
  - Python → Java (agent status updates via gRPC)
  - Java → Go (workflow task status via gRPC)
  - Go → Java (workflow execution status persistence)

---

## Sub-Tasks Breakdown

### Sub-Task 5.1: Child Agent Approval Detection (Go/Temporal)

**Duration**: 75-90 minutes
**Complexity**: MEDIUM-HIGH

#### Problem Statement

Workflows need to detect when a child agent enters EXECUTION_WAITING_FOR_APPROVAL phase and transition the corresponding workflow task to WORKFLOW_TASK_WAITING_APPROVAL.

#### Current Behavior

```go
// CallAgentActivity in task_builder_call_agent_activities.go
func (a *CallAgentActivities) CallAgentActivity(...) (any, error) {
    // Create agent execution
    execution := createAgentExecution(ctx, agentId, config, callbackToken)
    
    // Return immediately - activity paused until callback
    return nil, activity.ErrResultPending
}
```

The activity pauses and waits for async completion. There's NO polling or status checking currently.

#### Proposed Solution

**Option A**: Polling in Workflow (RECOMMENDED)
After starting the agent activity, add a parallel polling routine that watches the child execution and updates workflow status.

```go
// In task_builder_call_agent.go Build() method
func (t *CallAgentTaskBuilder) Build() (TemporalWorkflowFunc, error) {
    return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
        // Start agent execution (async)
        future := workflow.ExecuteActivity(ctx, 
            (*CallAgentActivities).CallAgentActivity, 
            t.agentConfig, input, state.Env)
        
        // Start parallel status watcher
        watchCtx, cancelWatch := workflow.WithCancel(ctx)
        defer cancelWatch()
        
        watchFuture := workflow.ExecuteActivity(watchCtx,
            (*CallAgentActivities).WatchAgentApprovalStatus,
            execution.Metadata.Id)
        
        // Wait for either activity to complete
        workflow.Await(ctx, func() bool {
            return future.IsReady() || watchFuture.IsReady()
        })
        
        // Handle approval detection
        if watchFuture.IsReady() {
            var approvalReq *ApprovalRequirement
            watchFuture.Get(ctx, &approvalReq)
            
            if approvalReq != nil {
                // Update workflow task status to WAITING_APPROVAL
                updateWorkflowTaskStatus(ctx, taskName, approvalReq)
            }
        }
        
        // Wait for agent to complete
        var result any
        future.Get(ctx, &result)
        return result, nil
    }, nil
}
```

**Option B**: Event-Based Notification (FUTURE)
Agent execution sends gRPC notification when entering approval state. More efficient but requires additional infrastructure.

#### Implementation Steps

1. **Add WatchAgentApprovalStatus Activity** (30 min)
  - New activity in `task_builder_call_agent_activities.go`
  - Polls child AgentExecution every 1-2 seconds
  - Returns when phase == EXECUTION_WAITING_FOR_APPROVAL
  - Returns ApprovalRequirement details from status.pending_approval
2. **Modify CallAgentTaskBuilder.Build()** (20 min)
  - Start watch activity in parallel with agent activity
  - Use `workflow.Await()` to wait for either completion or approval detection
  - Handle approval detection before agent completion
3. **Add Workflow Status Update Activity** (25 min)
  - New activity to call WorkflowExecution.updateStatus RPC
  - Updates task status to WORKFLOW_TASK_WAITING_APPROVAL
  - Copies approval details from child to parent
4. **Unit Tests** (15 min)
  - Test watch activity detects approval correctly
  - Test workflow task status update
  - Test normal completion path (no approval needed)

#### Files to Modify (stigmer repo)

```
backend/services/workflow-runner/pkg/zigflow/tasks/
  - task_builder_call_agent.go (+50 lines - parallel watch logic)
  - task_builder_call_agent_activities.go (+120 lines - watch activity)
  - task_builder_call_agent_test.go (+80 lines - new tests)
```

#### Testing Strategy

- Unit test: Mock agent execution entering WAITING_FOR_APPROVAL
- Unit test: Verify workflow task status updated correctly
- Unit test: Verify normal flow (no approval) unchanged

---

### Sub-Task 5.2: Workflow Status Propagation (Java/Temporal)

**Duration**: 60-75 minutes
**Complexity**: MEDIUM

#### Problem Statement

When a workflow task enters WORKFLOW_TASK_WAITING_APPROVAL, the WorkflowExecution status must reflect this at the top level for UI visibility.

#### Current Behavior

WorkflowExecution status tracks task statuses in `status.tasks[]`, but doesn't have a top-level `pending_approval` field.

#### Proposed Solution

**Add pending_approval to WorkflowExecutionStatus** (Proto change required):

```protobuf
// In workflowexecution/v1/api.proto
message WorkflowExecutionStatus {
    // ... existing fields ...
    
    // Pending approval for child agent tool execution (HITL Phase 1).
    // Populated when a workflow task invokes an agent that requires tool approval.
    // The approval details are copied from the child AgentExecution.status.pending_approval.
    // 
    // When this is set:
    // - At least one task has status WORKFLOW_TASK_WAITING_APPROVAL
    // - UI should display the approval prompt to the user
    // - User can submit approval via WorkflowExecution or AgentExecution API
    //
    // When approval is submitted:
    // - Approval is forwarded to the child AgentExecution
    // - Task returns to WORKFLOW_TASK_IN_PROGRESS
    // - This field is cleared
    PendingApproval pending_approval = 8;
}
```

#### Implementation Steps

1. **Proto Changes** (15 min)
  - Add `pending_approval` field to WorkflowExecutionStatus
  - Regenerate stubs (Java, Go, Python, TypeScript, Dart)
  - Verify buf build/lint passes
2. **Update Handler Logic** (20 min)
  - Modify `WorkflowExecutionUpdateStatusInput` handler
  - When task status = WORKFLOW_TASK_WAITING_APPROVAL:
    - Query child AgentExecution to get pending_approval details
    - Copy to WorkflowExecution.status.pending_approval
  - When task returns to IN_PROGRESS:
    - Clear WorkflowExecution.status.pending_approval
3. **Add Query Helper** (20 min)
  - New method: `getChildAgentApprovalDetails(taskId)`
  - Extracts agent_execution_id from task metadata
  - Queries AgentExecution.status.pending_approval
  - Maps to workflow-level PendingApproval
4. **Unit Tests** (15 min)
  - Test pending_approval populated when task enters WAITING_APPROVAL
  - Test pending_approval cleared when task resumes
  - Test approval details correctly copied from child

#### Files to Modify

**stigmer repo (proto)**:

```
apis/ai/stigmer/agentic/workflowexecution/v1/api.proto (+35 lines)
```

**stigmer-cloud repo (Java)**:

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/request/handler/
  - WorkflowExecutionUpdateStatusHandler.java (+80 lines)
  - WorkflowExecutionUpdateStatusHandlerTest.java (+120 lines)
```

#### Testing Strategy

- Unit test: Verify proto field added correctly
- Unit test: Handler populates pending_approval from child
- Unit test: Handler clears pending_approval on resume
- Integration test: End-to-end workflow → agent approval visibility

---

### Sub-Task 5.3: Approval Forwarding Mechanism (Java)

**Duration**: 75-90 minutes
**Complexity**: HIGH

#### Problem Statement

Users can submit approvals through the WorkflowExecution API. These approvals must be forwarded to the correct child AgentExecution.

#### Proposed Solution

**Add submitApproval RPC to WorkflowExecution Command Service**:

```protobuf
// In workflowexecution/v1/command.proto
service WorkflowExecutionCommandController {
    // ... existing RPCs ...
    
    // Submit approval for a child agent's tool execution (HITL Phase 1).
    // 
    // This RPC forwards the approval to the child AgentExecution.
    // The workflow execution must be in a state where:
    // - At least one task has status WORKFLOW_TASK_WAITING_APPROVAL
    // - status.pending_approval is populated with the approval request
    //
    // The approval is forwarded to the child agent via:
    // AgentExecution.submitApproval(child_execution_id, tool_call_id, action)
    //
    // After submission:
    // - Child agent resumes execution
    // - Workflow task returns to WORKFLOW_TASK_IN_PROGRESS
    // - WorkflowExecution.status.pending_approval is cleared
    rpc submitApproval(SubmitWorkflowApprovalInput) returns (WorkflowExecution);
}

message SubmitWorkflowApprovalInput {
    // Workflow execution ID
    string execution_id = 1 [(buf.validate.field).string.min_len = 1];
    
    // Tool call ID from pending_approval
    string tool_call_id = 2 [(buf.validate.field).string.min_len = 1];
    
    // Approval action (APPROVE, SKIP, REJECT)
    ApprovalAction action = 3 [(buf.validate.field).enum.defined_only = true];
    
    // Optional reason for the approval decision
    string reason = 4;
}
```

#### Implementation Steps

1. **Proto Changes** (15 min)
  - Add `submitApproval` RPC to WorkflowExecutionCommandController
  - Add `SubmitWorkflowApprovalInput` message
  - Import `ApprovalAction` from agentexecution/v1
  - Regenerate stubs
2. **Handler Implementation** (45 min)
  - Create `WorkflowExecutionSubmitApprovalHandler.java`
  - Pipeline pattern (similar to AgentExecutionSubmitApprovalHandler):
    - LoadExistingStep: Load workflow execution
    - AuthorizeStep: Check can_edit permission
    - ValidateApprovalStep: Verify WAITING_APPROVAL state, matching tool_call_id
    - ResolveChildExecutionStep: Extract child agent_execution_id from task metadata
    - ForwardApprovalStep: Call AgentExecution.submitApproval RPC
    - BuildResponseStep: Return updated WorkflowExecution
3. **Forwarding Logic** (20 min)
  - Use AgentExecutionCommandController client
  - Build SubmitApprovalInput for child agent
  - Handle errors (child not found, approval already submitted, etc.)
  - Wait for child to acknowledge (or use async pattern)
4. **Unit Tests** (20 min)
  - Test validation: execution not in WAITING_APPROVAL state
  - Test validation: tool_call_id mismatch
  - Test forwarding: approval correctly sent to child
  - Test idempotency: submitting same approval twice
  - Test authorization: unauthorized user cannot submit

#### Files to Create/Modify

**stigmer repo (proto)**:

```
apis/ai/stigmer/agentic/workflowexecution/v1/command.proto (+60 lines)
```

**stigmer-cloud repo (Java)**:

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/request/handler/
  - WorkflowExecutionSubmitApprovalHandler.java (NEW - ~350 lines)
  - WorkflowExecutionSubmitApprovalHandlerTest.java (NEW - ~400 lines)
```

#### Testing Strategy

- Unit test: All validation cases
- Unit test: Approval forwarding to child
- Unit test: Error handling (child not found, etc.)
- Integration test: End-to-end approval flow

---

### Sub-Task 5.4: Approval Resumption After Decision (Go/Temporal)

**Duration**: 60-75 minutes
**Complexity**: MEDIUM-HIGH

#### Problem Statement

After approval is submitted (via workflow or agent API), the workflow must detect the state change and resume the agent activity.

#### Current Behavior

After `ErrResultPending` is returned, the activity waits indefinitely for async completion via callback_token. There's no mechanism to detect approval submission.

#### Proposed Solution

**Extend Watch Activity to Detect Resume**:

```go
// In task_builder_call_agent_activities.go
func (a *CallAgentActivities) WatchAgentApprovalStatus(
    ctx context.Context,
    executionId string,
) (*ApprovalEvent, error) {
    ticker := time.NewTicker(2 * time.Second)
    defer ticker.Stop()
    
    var lastPhase agentexecv1.ExecutionPhase
    
    for {
        select {
        case <-ticker.C:
            activity.RecordHeartbeat(ctx, "watching agent approval")
            
            // Query agent execution
            execution := getAgentExecution(ctx, executionId)
            phase := execution.Status.Phase
            
            // Detect state changes
            if phase == agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
                if lastPhase != phase {
                    // Just entered approval state
                    return &ApprovalEvent{
                        Type: "approval_required",
                        Approval: execution.Status.PendingApproval,
                    }, nil
                }
            } else if lastPhase == agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
                // Just left approval state (approved/rejected)
                return &ApprovalEvent{
                    Type: "approval_resolved",
                    Action: getLastApprovalAction(execution),
                }, nil
            }
            
            // Terminal state - stop watching
            if isTerminalPhase(phase) {
                return nil, nil
            }
            
            lastPhase = phase
            
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
}
```

The workflow already waits for agent completion via callback_token. When approval is submitted, the agent resumes and eventually completes, triggering the callback.

**Actually, NO CHANGES NEEDED in Go code!** The async completion pattern handles this:

1. User submits approval
2. Agent resumes execution (LangGraph Command(resume=decision))
3. Agent completes normally
4. Agent workflow calls completion callback with token
5. CallAgentActivity receives result and workflow continues

The watch activity only needs to detect approval ENTRY for status updates, not approval EXIT.

#### Implementation Steps

1. **Verify Callback Flow** (30 min)
  - Review agent workflow callback logic in Java
  - Confirm callback is triggered after approval resolution
  - Add logging to track approval → completion flow
2. **Add Status Clearing Logic** (20 min)
  - When agent completes (callback received), clear workflow task WAITING_APPROVAL
  - Update workflow execution status to clear pending_approval
  - Transition task from WAITING_APPROVAL → COMPLETED
3. **Unit Tests** (20 min)
  - Test watch activity stops after terminal state
  - Test workflow task status cleared on completion
  - Test end-to-end: approval → resume → completion

#### Files to Modify

**stigmer-cloud repo (Java)**:

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/
  - InvokeAgentExecutionWorkflowImpl.java (+30 lines - clear callback_token after approval completion)
```

**stigmer repo (Go)**:

```
backend/services/workflow-runner/pkg/zigflow/tasks/
  - task_builder_call_agent_activities.go (+20 lines - verify terminal state detection)
```

#### Testing Strategy

- Unit test: Verify callback triggered after approval
- Unit test: Verify workflow task status cleared
- Integration test: Full cycle (approval → resume → complete)

---

### Sub-Task 5.5: End-to-End Integration Testing (All Components)

**Duration**: 90-120 minutes
**Complexity**: HIGH

#### Problem Statement

Validate the complete workflow → agent → approval → resolution flow works across all components (Go, Java, Python).

#### Test Scenarios

1. **Happy Path: Approve Tool**
  - Create workflow with agent task
  - Agent requires tool approval
  - Workflow enters WORKFLOW_TASK_WAITING_APPROVAL
  - Submit approval via WorkflowExecution.submitApproval
  - Agent resumes and completes tool
  - Workflow task completes
  - Workflow completes successfully
2. **Happy Path: Skip Tool**
  - Same as above, but submit SKIP action
  - Agent skips tool execution
  - Agent continues with skip message
3. **Reject Path**
  - Submit REJECT action
  - Agent execution fails with ToolExecutionRejectedError
  - Workflow task enters WORKFLOW_TASK_FAILED
  - Workflow execution enters EXECUTION_FAILED
4. **Direct Agent Approval Path**
  - Submit approval via AgentExecution.submitApproval (not workflow)
  - Approval resolved at agent level
  - Workflow detects resolution and continues
5. **Multiple Agents in Workflow**
  - Workflow with 3 agent tasks
  - Second agent requires approval
  - Only that task enters WAITING_APPROVAL
  - Other tasks remain unaffected
6. **Timeout Handling**
  - Agent requires approval
  - No approval submitted within timeout
  - Agent fails with timeout error
  - Workflow task fails

#### Implementation Steps

1. **Setup Test Environment** (20 min)
  - Deploy all services (stigmer-service, agent-runner, workflow-runner)
  - Create test workflow with agent task
  - Create test agent with approval-required MCP tool
2. **Write Integration Tests** (60 min)
  - Test each scenario above
  - Use actual gRPC clients
  - Verify state transitions at each level
3. **Debug and Fix Issues** (30 min)
  - Track down any integration issues
  - Fix race conditions, timing issues
  - Add necessary logging
4. **Document Test Results** (10 min)
  - Record test coverage
  - Document any known limitations
  - Update task file with test results

#### Files to Create

**stigmer repo (integration tests)**:

```
test/integration/hitl_approval_flow/
  - workflow_agent_approval_test.go (NEW - ~500 lines)
  - fixtures/ (test workflows, agents, tools)
```

#### Testing Strategy

- Run tests against local environment
- Run tests against staging environment
- Verify all approval actions (approve, skip, reject)
- Verify both approval submission paths (workflow vs agent)

---

## Success Criteria

### Functional Requirements

- Workflow tasks correctly transition to WORKFLOW_TASK_WAITING_APPROVAL when child agent needs approval
- WorkflowExecution.status.pending_approval correctly populated with approval details
- WorkflowExecution.submitApproval correctly forwards approval to child agent
- AgentExecution.submitApproval continues to work (backward compatibility)
- Workflow resumes after approval submission
- All approval actions work (APPROVE, SKIP, REJECT)

### Non-Functional Requirements

- No polling storms (max 1 query/2 seconds per workflow)
- Approval state changes visible in UI within 5 seconds
- No breaking changes to existing workflows without approval requirements
- Comprehensive test coverage (80%+ for new code)
- Clear audit trail for all approval decisions

### Quality Requirements

- Zero technical debt introduced
- All linter errors fixed
- All tests passing
- Documentation updated (ADR, README)
- Code reviewed and approved

---

## Risks and Mitigations

### Risk 1: Race Conditions in Status Detection

**Impact**: HIGH - Workflow might miss approval state change
**Mitigation**: 

- Use versioned status updates (optimistic locking)
- Add idempotency checks in all handlers
- Test with concurrent approval submissions

### Risk 2: Performance Impact of Polling

**Impact**: MEDIUM - Too many status queries could overload database
**Mitigation**:

- Limit poll frequency to 2 seconds
- Use database connection pooling
- Add monitoring for query latency

### Risk 3: Callback Token Timeout

**Impact**: MEDIUM - Workflow might timeout waiting for approval
**Mitigation**:

- Set appropriate activity timeouts (24+ hours)
- Implement timeout detection and graceful failure
- Add retry logic for transient failures

### Risk 4: Proto Breaking Changes

**Impact**: LOW - Adding fields to proto could break existing clients
**Mitigation**:

- Use optional fields (proto3 semantics)
- Add backward compatibility tests
- Version bump if needed

---

## Dependencies

### External Dependencies

- None

### Internal Dependencies

- Phase 4 complete (AgentExecution approval handler working)
- LangGraph interrupt/resume working (Phase 3B)
- Temporal async completion pattern working

### Breaking Changes

- None expected (all changes are additive)

---

## Rollout Strategy

### Phase 1: Dark Launch (Internal Testing)

- Deploy to dev environment
- Test with internal workflows
- Monitor for errors and performance issues

### Phase 2: Beta Release (Selected Users)

- Enable for beta users via feature flag
- Gather feedback on UX
- Fix any discovered issues

### Phase 3: General Availability

- Enable for all users
- Monitor metrics (approval latency, error rates)
- Iterate based on feedback

---

## Monitoring and Observability

### Metrics to Track

- Approval state detection latency (workflow → agent)
- Approval resolution latency (submit → resume)
- Poll frequency per workflow execution
- Approval timeout rate
- Error rate by sub-task

### Logs to Add

- When workflow task enters WAITING_APPROVAL (with task_id, agent_execution_id)
- When approval is forwarded to child agent
- When approval is resolved (with action and latency)
- Any errors in watch activity or approval forwarding

### Alerts to Configure

- High approval timeout rate (> 5%)
- High error rate in watch activity (> 1%)
- High approval resolution latency (> 10 seconds P95)

---

## Post-Implementation Tasks

1. Update documentation:
  - API documentation (submitApproval RPC)
  - User guide (how to use workflow approvals)
  - ADR (architectural decisions for Phase 5)
2. Performance optimization:
  - Profile polling overhead
  - Consider event-based notification for future improvement
  - Optimize status query performance
3. UI updates:
  - Display workflow-level approval prompts
  - Add "Submit Approval" button to workflow execution page
  - Show approval history in workflow timeline

---

## Estimated Timeline

- Sub-Task 5.1: 75-90 minutes
- Sub-Task 5.2: 60-75 minutes
- Sub-Task 5.3: 75-90 minutes
- Sub-Task 5.4: 60-75 minutes
- Sub-Task 5.5: 90-120 minutes

**Total: 6-8 hours** (spread across 1-2 days with testing and review)

---

## Notes for Implementation

1. Start with Sub-Task 5.2 (Proto changes) first - foundation for everything else
2. Sub-Tasks 5.1 and 5.3 can be done in parallel (Go and Java are independent)
3. Sub-Task 5.4 is mostly verification - the async pattern handles resume automatically
4. Sub-Task 5.5 integration testing is CRITICAL - do not skip

---

**Next Steps**: Review this plan, get approval, then implement Sub-Task 5.2 (Proto + Java status propagation).