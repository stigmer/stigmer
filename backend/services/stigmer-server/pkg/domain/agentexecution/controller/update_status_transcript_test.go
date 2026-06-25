package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Full-pipeline persistence reproduction of the reported APPROVE_ALL flow.
//
// Unlike update_status_guard_test.go (which exercises the in-memory merge in
// isolation), this drives the REAL UpdateStatus and SubmitApproval controller
// pipelines against a REAL sqlite store and reloads the durably-persisted blob.
// The assertion therefore reflects what survives an actual round-trip, including
// PreserveApprovalFields, EnsureApprovalRequests, ProjectPendingApprovals, and
// the atomic UpdateResource persist.
//
// It models the exact sequence the user observed against open-computer-use:
//
//  1. The runner persists the gated run-1 transcript while parked at the gate:
//     [THINKING, AI(getAppState WAITING_APPROVAL)].
//  2. The user approves with APPROVE_ALL — SubmitApproval records the decision
//     on the gated tool call (server-owned field).
//  3. A durable-checkpoint resume rebuilds the transcript WITHOUT the leading
//     thinking block and first tool call but appends the later leased tools, and
//     the runner sends it via UpdateStatus.
//
// The leading thinking block, the first tool call, AND its recorded APPROVE_ALL
// decision must all survive. They do not today: the count-only shrink guard
// accepts the equal-or-longer regressed list, the wholesale replace wipes the
// leading history, and the approval decision goes with it because
// PreserveApprovalFields can only re-attach to a tool call still present.
func TestUpdateStatus_ApproveAllResume_PreservesEarlierThinkingAndFirstToolCall(t *testing.T) {
	controller, cs := setupCountingController(t)
	defer cs.Close()

	ctx := contextWithAgentExecutionKind()
	const id = "exec-approve-all-resume"
	const gatedToolCallID = "tc-getappstate"

	// 1. Seed the gated run-1 transcript through the embedded store (uncounted).
	seed := &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: id},
		Spec:       &agentexecutionv1.AgentExecutionSpec{},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_THINKING, Content: "planning the self-DM"},
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, ToolCalls: []*agentexecutionv1.ToolCall{{
					Id:               gatedToolCallID,
					Name:             "getAppState",
					Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
					RequiresApproval: true,
					McpServerSlug:    "open-computer-use",
				}}},
			},
		},
	}
	if err := cs.Store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, seed); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	// 2. The user approves with APPROVE_ALL (records the decision on the call).
	if _, err := controller.SubmitApproval(ctx, &agentexecutionv1.SubmitApprovalInput{
		AgentExecutionId: id,
		ToolCallId:       gatedToolCallID,
		Action:           agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL,
	}); err != nil {
		t.Fatalf("SubmitApproval failed: %v", err)
	}

	// 3. The resume sends a regressed transcript: leading thinking + getAppState
	//    gone, later leased tools appended. len(incoming)=3 >= existing=2, so the
	//    count-only shrink guard does not fire.
	regressed := &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: []*agentexecutionv1.AgentMessage{
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, ToolCalls: []*agentexecutionv1.ToolCall{{
				Id: "tc-click", Name: "click", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
			}}},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, ToolCalls: []*agentexecutionv1.ToolCall{{
				Id: "tc-scroll", Name: "scroll", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
			}}},
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "done"},
		},
	}
	if _, err := controller.UpdateStatus(ctx, &agentexecutionv1.AgentExecutionUpdateStatusInput{
		ExecutionId: id,
		Status:      regressed,
	}); err != nil {
		t.Fatalf("UpdateStatus failed: %v", err)
	}

	// Reload the durably-persisted blob and assert the leading history survived.
	final := &agentexecutionv1.AgentExecution{}
	if err := cs.Store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, id, final); err != nil {
		t.Fatalf("reload failed: %v", err)
	}

	hasThinking := false
	for _, m := range final.GetStatus().GetMessages() {
		if m.GetType() == agentexecutionv1.MessageType_MESSAGE_THINKING && m.GetContent() == "planning the self-DM" {
			hasThinking = true
		}
	}
	if !hasThinking {
		t.Fatalf("the leading thinking block must survive the approve-all resume round-trip; it was wiped by the wholesale replace")
	}

	gated := findToolCallInExecution(final, gatedToolCallID)
	if gated == nil {
		t.Fatalf("the first tool call (getAppState) must survive the resume round-trip; it was dropped by the count-only guard")
	}
	if gated.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL {
		t.Fatalf("the recorded APPROVE_ALL decision must survive on the first tool call; got %s", gated.GetApprovalAction())
	}
}
