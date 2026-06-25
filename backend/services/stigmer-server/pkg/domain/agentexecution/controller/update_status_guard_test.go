package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
)

// runBuildStep applies the UpdateStatus merge to a clone of the existing
// execution and returns the merged result. Cloning mirrors the freshly-loaded
// resource the merge mutates in place inside the UpdateResource write lock.
func runBuildStep(
	t *testing.T,
	existing *agentexecutionv1.AgentExecution,
	incoming *agentexecutionv1.AgentExecutionStatus,
) *agentexecutionv1.AgentExecution {
	t.Helper()

	input := &agentexecutionv1.AgentExecutionUpdateStatusInput{
		ExecutionId: existing.Metadata.Id,
		Status:      incoming,
	}
	merged := proto.Clone(existing).(*agentexecutionv1.AgentExecution)
	applyUpdateStatusMerge(merged, input)
	return merged
}

func messages(contents ...string) []*agentexecutionv1.AgentMessage {
	out := make([]*agentexecutionv1.AgentMessage, 0, len(contents))
	for _, c := range contents {
		out = append(out, &agentexecutionv1.AgentMessage{Content: c})
	}
	return out
}

func existingWith(phase agentexecutionv1.ExecutionPhase, msgs ...string) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-guard", Name: "exec-guard"},
		Spec:     &agentexecutionv1.AgentExecutionSpec{},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    phase,
			Messages: messages(msgs...),
		},
	}
}

// A non-terminal execution must never have its transcript shrunk by a partial
// (regressed) status update — the durable-checkpoint resume failure mode.
func TestBuildNewState_RejectsShrinkingMessagesForNonTerminal(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, "m1", "m2", "m3")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: messages("only-one"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 3 {
		t.Fatalf("expected existing 3 messages preserved, got %d", got)
	}
	if merged.Status.Messages[0].Content != "m1" {
		t.Fatalf("expected original transcript kept, got %q", merged.Status.Messages[0].Content)
	}
}

// The runner<->backend approval finalize is now append-only by construction:
// when a Cursor turn pauses for approval, the runner REDACTS the model's
// post-denial narration in place (blanks the message content, keeping the
// message), so the incoming WAITING_FOR_APPROVAL transcript has the SAME length
// as the in-progress transcript it already streamed. The guard accepts it as a
// normal equal-length replacement — no phase carve-out — and the gated tool
// call's WAITING_APPROVAL status projects exactly one pending approval.
func TestBuildNewState_AcceptsEqualLengthApprovalFinalize(t *testing.T) {
	existing := &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-guard", Name: "exec-guard"},
		Spec:     &agentexecutionv1.AgentExecutionSpec{},
		Status: &agentexecutionv1.AgentExecutionStatus{
			// In-progress full transcript already streamed: pre-tool text, the
			// gated tool call (reported by the stream as a failure, NOT yet
			// WAITING_APPROVAL), and the model's post-denial narration.
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			Messages: []*agentexecutionv1.AgentMessage{
				{Content: "let me create the file"},
				{ToolCalls: []*agentexecutionv1.ToolCall{{
					Id:               "tc-write",
					Name:             "Write",
					Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED,
					RequiresApproval: true,
				}}},
				{Content: "I could not write the file; approve it when prompted"},
			},
		},
	}
	// Append-only clean-pause finalize: SAME length, the gated tool call now
	// WAITING_APPROVAL and the trailing narration BLANKED in place (content "").
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		Messages: []*agentexecutionv1.AgentMessage{
			{Content: "let me create the file"},
			{ToolCalls: []*agentexecutionv1.ToolCall{{
				Id:               "tc-write",
				Name:             "Write",
				Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
				RequiresApproval: true,
			}}},
			{Content: ""},
		},
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 3 {
		t.Fatalf("append-only approval finalize must keep all 3 messages (narration blanked, not removed); got %d", got)
	}
	if got := merged.Status.Messages[2].Content; got != "" {
		t.Fatalf("expected the trailing narration blanked in place, got %q", got)
	}
	if got := len(merged.Status.PendingApprovals); got != 1 {
		t.Fatalf("the gated tool call's WAITING_APPROVAL must project exactly one pending approval; expected 1, got %d", got)
	}
	if got := merged.Status.PendingApprovals[0].GetToolCallId(); got != "tc-write" {
		t.Fatalf("expected the pending approval to project the gated tool call tc-write, got %q", got)
	}
}

// With the shrink exception deleted, the guard no longer trusts the incoming
// phase: a WAITING_FOR_APPROVAL update that is SHORTER than the existing
// transcript is now rejected exactly like any other non-terminal shrink. This
// pins that the runner's redact-in-place finalize is the only supported shape —
// any future regression back to removing messages fails here instead of slipping
// through a phase-keyed carve-out.
func TestBuildNewState_RejectsShrinkingApprovalFinalize(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1", "m2", "m3")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		Messages: messages("m1", "m2"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 3 {
		t.Fatalf("a shrinking WAITING_FOR_APPROVAL finalize must now be rejected; expected existing 3 messages preserved, got %d", got)
	}
}

// A growing transcript (the normal streaming case) is accepted.
func TestBuildNewState_AcceptsGrowingMessages(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1", "m2")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: messages("m1", "m2", "m3"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 3 {
		t.Fatalf("expected 3 messages after growth, got %d", got)
	}
}

// An equal-length replacement (in-place mutation of the same turns) is accepted.
func TestBuildNewState_AcceptsEqualLengthMessages(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1", "m2")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: messages("m1-updated", "m2-updated"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 2 {
		t.Fatalf("expected 2 messages, got %d", got)
	}
	if merged.Status.Messages[0].Content != "m1-updated" {
		t.Fatalf("expected equal-length replacement applied, got %q", merged.Status.Messages[0].Content)
	}
}

// findToolCall scans the whole transcript (every message) for a tool call by id.
func findToolCall(status *agentexecutionv1.AgentExecutionStatus, id string) *agentexecutionv1.ToolCall {
	for _, m := range status.GetMessages() {
		for _, tc := range m.GetToolCalls() {
			if tc.GetId() == id {
				return tc
			}
		}
	}
	return nil
}

// completedToolMsg builds an AI message carrying a single COMPLETED tool call —
// the shape a resumed turn streams for an auto-executed (leased) tool.
func completedToolMsg(id, name string) *agentexecutionv1.AgentMessage {
	return &agentexecutionv1.AgentMessage{
		Type: agentexecutionv1.MessageType_MESSAGE_AI,
		ToolCalls: []*agentexecutionv1.ToolCall{{
			Id:     id,
			Name:   name,
			Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
		}},
	}
}

// Front-truncation-with-append is the gap the count-only guard cannot see.
//
// Run 1 persisted a leading THINKING block and the gated getAppState call the
// user then approved with APPROVE_ALL (leasing the whole MCP server). The
// reported failure is a post-approval update whose transcript dropped BOTH the
// leading thinking block and the first getAppState call while appending the
// later auto-executed (leased) tools. Because the net length is equal-or-greater
// than the existing transcript, `wouldShrink` (len(incoming) < existing) is
// false, the wholesale replace runs, and the leading history is wiped.
//
// This pins the contract the guard SHOULD enforce: a non-terminal update must
// not silently drop previously-committed leading messages or tool calls, not
// merely refuse a strictly-shorter list. It fails today — the count-only guard
// is blind to front-truncation as long as the list grew back.
func TestBuildNewState_RejectsFrontTruncationWithAppend(t *testing.T) {
	existing := &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-guard", Name: "exec-guard"},
		Spec:     &agentexecutionv1.AgentExecutionSpec{},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_THINKING, Content: "planning the self-DM"},
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, ToolCalls: []*agentexecutionv1.ToolCall{{
					Id:               "tc-getappstate",
					Name:             "getAppState",
					Status:           agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
					RequiresApproval: true,
					ApprovalAction:   agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL,
					McpServerSlug:    "open-computer-use",
				}}},
			},
		},
	}
	// Regressed resume transcript: leading thinking + getAppState gone, later
	// leased tools appended. len(incoming)=3 >= existing=2 → guard does not fire.
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages: []*agentexecutionv1.AgentMessage{
			completedToolMsg("tc-click", "click"),
			completedToolMsg("tc-scroll", "scroll"),
			{Type: agentexecutionv1.MessageType_MESSAGE_AI, Content: "done"},
		},
	}

	merged := runBuildStep(t, existing, incoming)

	hasThinking := false
	for _, m := range merged.Status.Messages {
		if m.Type == agentexecutionv1.MessageType_MESSAGE_THINKING && m.Content == "planning the self-DM" {
			hasThinking = true
		}
	}
	if !hasThinking {
		t.Fatalf("the leading thinking block must survive a front-truncated-but-appended update; it was dropped by the count-only guard")
	}
	if findToolCall(merged.Status, "tc-getappstate") == nil {
		t.Fatalf("the first tool call (getAppState) must survive a front-truncated-but-appended update; it was dropped by the count-only guard")
	}
}

// The guard is scoped to non-terminal executions: a terminal execution may be
// rewritten (e.g. an administrative correction) without the shrink guard.
func TestBuildNewState_AllowsShrinkForTerminal(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "m1", "m2", "m3")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		Messages: messages("single"),
	}

	merged := runBuildStep(t, existing, incoming)

	if got := len(merged.Status.Messages); got != 1 {
		t.Fatalf("expected terminal replacement applied (1 message), got %d", got)
	}
}
