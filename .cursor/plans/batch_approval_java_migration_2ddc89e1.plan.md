---
name: Batch Approval Java Migration
overview: Migrate the stigmer-cloud Java backend from the deprecated singular `pending_approval` field to the plural `pending_approvals` (batch) field, and update `ChildApprovalNotification` to support batch approvals -- matching the changes already completed in the stigmer OSS repo.
todos:
  - id: agent-submit-approval
    content: "Update AgentExecutionSubmitApprovalHandler.java: singular to plural pending_approvals validation and audit logging"
    status: completed
  - id: agent-update-status
    content: "Update AgentExecutionUpdateStatusHandler.java: singular to plural pending_approvals merging logic"
    status: completed
  - id: workflow-submit-approval
    content: "Update WorkflowExecutionSubmitApprovalHandler.java: singular to plural pending_approvals validation and forwarding"
    status: completed
  - id: workflow-update-status
    content: "Update WorkflowExecutionUpdateStatusHandler.java: singular to plural pending_approvals merging logic"
    status: completed
  - id: workflow-impl
    content: "Update InvokeAgentExecutionWorkflowImpl.java: approval loop, parent notification (ChildApprovalNotification batch), and defensive validation"
    status: completed
  - id: activity-files
    content: Check and update UpdateExecutionStatusActivityImpl.java and NotifyParentActivitiesImpl.java if they reference singular field
    status: completed
  - id: build-verify
    content: Verify clean compilation with bazelw build
    status: completed
isProject: false
---

# Batch Approval Cleanup: Java Migration in stigmer-cloud

## Context

Two changelogs describe changes made in the stigmer OSS repo:

1. **Fix Approval Tool Result Extraction** -- Backend Python + CLI Go fix for LangGraph `Command` object handling. **Not applicable to Java code** since tool result extraction happens in Python (agent-runner), not Java. The Java service only orchestrates and persists; it never processes LangGraph Command objects or ToolMessage repr strings.
2. **Batch Approval Cleanup** -- Removes deprecated singular `pending_approval`, establishes `pending_approvals` (plural) as the sole source. **This is the change that needs porting to Java.**

## Current State in stigmer-cloud

Proto stubs have already been regenerated. All Java code still exclusively uses the **singular** `getPendingApproval()` pattern which no longer exists in the regenerated stubs. The code will fail to compile until the Java service files are updated to use the plural `getPendingApprovalsList()` / `addAllPendingApprovals()` APIs. The `ChildApprovalNotification` has been restructured to the new batch format (`executionId` + `repeated PendingApproval`).

## Step 1: AgentExecutionSubmitApprovalHandler.java

File: [AgentExecutionSubmitApprovalHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionSubmitApprovalHandler.java)

### ValidateApprovalStep (lines 252-280)

- **Current**: `getPendingApproval()` -- validates singular tool_call_id match
- **Change**: Use `getPendingApprovalsList()`, iterate to find matching tool_call_id. Return `FAILED_PRECONDITION` if list is empty ("no pending approvals"). Return `INVALID_ARGUMENT` if requested tool_call_id not found in list.
- Store matched `PendingApproval` in context attribute for downstream steps.

### BuildResponseStep (lines 511-512)

- **Current**: `execution.getStatus().getPendingApproval().getToolName()` / `.getArgsPreview()`
- **Change**: Retrieve the matched `PendingApproval` from context attribute (set by ValidateApprovalStep), use that for audit logging.

## Step 2: AgentExecutionUpdateStatusHandler.java

File: [AgentExecutionUpdateStatusHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionUpdateStatusHandler.java)

### BuildNewStateWithStatusStep (lines 238-270)

- **Current**: `hasPendingApproval()` / `setPendingApproval()` / `clearPendingApproval()` on singular field
- **Change**: Handle the repeated `pending_approvals` field:
  - If `requestStatus.getPendingApprovalsCount() > 0` and first entry has non-empty `toolCallId` -- set `pendingApprovals` list
  - If `requestStatus.getPendingApprovalsCount() > 0` and first entry has empty `toolCallId` -- clear signal, clear list
  - If count is 0 -- preserve existing (don't touch)
- Update log messages to reference plural field and count

## Step 3: WorkflowExecutionSubmitApprovalHandler.java

File: [WorkflowExecutionSubmitApprovalHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/request/handler/WorkflowExecutionSubmitApprovalHandler.java)

### ValidateApprovalStep (lines 206-275)

- **Current**: `hasPendingApproval()` + `getPendingApproval()` -- singular validation
- **Change**: Use `getPendingApprovalsList()`. Return `FAILED_PRECONDITION` if empty. Iterate to find matching tool_call_id. Extract `childAgentExecutionId` from matched entry.

### BuildResponseStep (lines 417-420)

- **Current**: `execution.getStatus().getPendingApproval()` for audit logging
- **Change**: Retrieve matched `PendingApproval` from context attribute

## Step 4: WorkflowExecutionUpdateStatusHandler.java

File: [WorkflowExecutionUpdateStatusHandler.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/request/handler/WorkflowExecutionUpdateStatusHandler.java)

### BuildNewStateWithStatusStep (lines 213-241)

- **Current**: `hasPendingApproval()` / `setPendingApproval()` / `clearPendingApproval()` on singular field
- **Change**: Same pattern as Step 2 -- handle repeated `pending_approvals` field with set/clear/preserve semantics
- Update log messages

## Step 5: InvokeAgentExecutionWorkflowImpl.java

File: [InvokeAgentExecutionWorkflowImpl.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java)

### Approval Loop (lines 549-637)

- **Current** (line 561): `finalStatus.getPendingApproval()` -- singular, waits for 1 signal
- **Change**: Use `finalStatus.getPendingApprovalsList()`. The approval loop condition checks `getPendingApprovalsCount() > 0` when phase is WAITING_FOR_APPROVAL. For the signal waiting, use `len(getPendingApprovalsList())` as `signalsNeeded`, collect that many approval decisions before re-invoking.
- Update logging to include `pending_count` and `first_tool_call_id`

### notifyParentWorkflowOfApproval (lines 877-920)

- **Current** (line 890): Builds `ChildApprovalNotification` with individual fields from singular `getPendingApproval()`
- **Change**: Build with new batch structure:

```java
ChildApprovalNotification notification = ChildApprovalNotification.newBuilder()
    .setExecutionId(executionId)
    .addAllPendingApprovals(status.getPendingApprovalsList())
    .build();
```

### Defensive validation (lines 656-670)

- **Current**: `finalStatus.getPendingApproval()` -- checks singular for stale state
- **Change**: Check `getPendingApprovalsList()` -- if any entries remain with non-empty tool_call_ids after approval flow, clear the list

## Step 6: UpdateExecutionStatusActivityImpl.java

File: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/activities/UpdateExecutionStatusActivityImpl.java`

- Check if this file also handles `pendingApproval` -- if so, apply the same singular-to-plural migration

## Step 7: NotifyParentActivitiesImpl.java

File: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/activities/NotifyParentActivitiesImpl.java`

- Update if the `ChildApprovalNotification` payload construction needs changes (should be transparent since the notification is built in the workflow, not in the activity)

## Step 8: Build Verification

After all changes, verify compilation:

```bash
cd stigmer-cloud && bazelw build //backend/services/stigmer-service/...
```

## Not Applicable to Java

- **Changelog 1 (Tool Result Extraction)**: LangGraph `Command` object handling and `stripToolMessageRepr` are Python/Go concerns. The Java service receives already-extracted results via gRPC status updates. No Java changes needed.
- **CLI in stigmer-cloud**: The cloud CLI (`client-apps/cli/`) does not appear to have approval prompt handling or ToolMessage repr stripping. The streaming code displays messages and tool calls directly without any pending_approval field access. No changes needed unless approval prompts are being added separately.

