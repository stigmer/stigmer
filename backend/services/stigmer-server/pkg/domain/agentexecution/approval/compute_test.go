package approval

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func makeToolCall(id, name string, status agentexecutionv1.ToolCallStatus, requiresApproval bool, action agentexecutionv1.ApprovalAction) *agentexecutionv1.ToolCall {
	return &agentexecutionv1.ToolCall{
		Id:                  id,
		Name:                name,
		Status:              status,
		RequiresApproval:    requiresApproval,
		ApprovalAction:      action,
		ApprovalMessage:     "Approve " + name,
		ArgsPreview:         `{"key":"value"}`,
		ApprovalRequestedAt: "2026-03-27T10:00:00Z",
	}
}

func makeAIMessage(toolCalls ...*agentexecutionv1.ToolCall) *agentexecutionv1.AgentMessage {
	return &agentexecutionv1.AgentMessage{
		Type:      agentexecutionv1.MessageType_MESSAGE_AI,
		ToolCalls: toolCalls,
	}
}

func TestComputePendingApprovals(t *testing.T) {
	tests := []struct {
		name               string
		messages           []*agentexecutionv1.AgentMessage
		subAgentExecutions []*agentexecutionv1.SubAgentExecution
		wantCount          int
		wantIDs            []string
		wantFromSubAgent   []bool
		wantSubAgentNames  []string
	}{
		{
			name:      "empty messages",
			messages:  nil,
			wantCount: 0,
		},
		{
			name: "AI message with no tool calls",
			messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_AI},
			},
			wantCount: 0,
		},
		{
			name: "tool call WAITING_APPROVAL and requires_approval included",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "delete_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
			wantCount:        1,
			wantIDs:          []string{"tc1"},
			wantFromSubAgent: []bool{false},
		},
		{
			name: "tool call WAITING_APPROVAL with approval_action set excluded",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "delete_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE),
				),
			},
			wantCount: 0,
		},
		{
			name: "tool call RUNNING excluded",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "delete_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
			wantCount: 0,
		},
		{
			name: "tool call COMPLETED excluded",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "delete_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
			wantCount: 0,
		},
		{
			name: "tool call WAITING_APPROVAL without requires_approval excluded",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "delete_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, false, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
			wantCount: 0,
		},
		{
			name: "sub-agent tool calls set from_sub_agent and sub_agent_name",
			subAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{
					Name: "code-reviewer",
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-sub1", "run_tests", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
			},
			wantCount:         1,
			wantIDs:           []string{"tc-sub1"},
			wantFromSubAgent:  []bool{true},
			wantSubAgentNames: []string{"code-reviewer"},
		},
		{
			name: "mix of root and sub-agent tool calls correct attribution",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "delete_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
					makeToolCall("tc2", "read_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
			subAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{
					Name: "debugger",
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-sub1", "execute_sql", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
			},
			wantCount:         2,
			wantIDs:           []string{"tc1", "tc-sub1"},
			wantFromSubAgent:  []bool{false, true},
			wantSubAgentNames: []string{"", "debugger"},
		},
		{
			name: "multiple messages across multiple sub-agents",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "deploy", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
			subAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{
					Name: "agent-a",
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-a1", "write_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
				{
					Name: "agent-b",
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-b1", "send_email", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
							makeToolCall("tc-b2", "read_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED, false, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
			},
			wantCount:         3,
			wantIDs:           []string{"tc1", "tc-a1", "tc-b1"},
			wantFromSubAgent:  []bool{false, true, true},
			wantSubAgentNames: []string{"", "agent-a", "agent-b"},
		},
		{
			name: "fields projected correctly",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc1", "delete_repo", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
			wantCount: 1,
			wantIDs:   []string{"tc1"},
		},
		{
			name: "completed sub-agent excluded even with WAITING_APPROVAL tools",
			subAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{
					Name:   "researcher",
					Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED,
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-orphan", "execute", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
			},
			wantCount: 0,
		},
		{
			name: "failed sub-agent excluded",
			subAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{
					Name:   "deployer",
					Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED,
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-fail", "deploy", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
			},
			wantCount: 0,
		},
		{
			name: "running sub-agent still included",
			subAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{
					Name:   "coder",
					Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS,
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-active", "execute", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
			},
			wantCount:         1,
			wantIDs:           []string{"tc-active"},
			wantFromSubAgent:  []bool{true},
			wantSubAgentNames: []string{"coder"},
		},
		{
			name: "mix of terminal and active sub-agents only active included",
			subAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{
					Name:   "done-agent",
					Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED,
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-done", "execute", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
				{
					Name:   "live-agent",
					Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS,
					Messages: []*agentexecutionv1.AgentMessage{
						makeAIMessage(
							makeToolCall("tc-live", "execute", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
						),
					},
				},
			},
			wantCount:         1,
			wantIDs:           []string{"tc-live"},
			wantFromSubAgent:  []bool{true},
			wantSubAgentNames: []string{"live-agent"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ComputePendingApprovals(tt.messages, tt.subAgentExecutions)

			if len(got) != tt.wantCount {
				t.Fatalf("got %d pending approvals, want %d", len(got), tt.wantCount)
			}

			for i, pa := range got {
				if i < len(tt.wantIDs) && pa.GetToolCallId() != tt.wantIDs[i] {
					t.Errorf("pa[%d].ToolCallId = %q, want %q", i, pa.GetToolCallId(), tt.wantIDs[i])
				}
				if i < len(tt.wantFromSubAgent) && pa.GetFromSubAgent() != tt.wantFromSubAgent[i] {
					t.Errorf("pa[%d].FromSubAgent = %v, want %v", i, pa.GetFromSubAgent(), tt.wantFromSubAgent[i])
				}
				if i < len(tt.wantSubAgentNames) && pa.GetSubAgentName() != tt.wantSubAgentNames[i] {
					t.Errorf("pa[%d].SubAgentName = %q, want %q", i, pa.GetSubAgentName(), tt.wantSubAgentNames[i])
				}
			}

			// Verify field projection for the "fields projected correctly" test case.
			if tt.name == "fields projected correctly" && len(got) > 0 {
				pa := got[0]
				if pa.GetToolName() != "delete_repo" {
					t.Errorf("ToolName = %q, want %q", pa.GetToolName(), "delete_repo")
				}
				if pa.GetMessage() != "Approve delete_repo" {
					t.Errorf("Message = %q, want %q", pa.GetMessage(), "Approve delete_repo")
				}
				if pa.GetArgsPreview() != `{"key":"value"}` {
					t.Errorf("ArgsPreview = %q, want %q", pa.GetArgsPreview(), `{"key":"value"}`)
				}
				if pa.GetRequestedAt() != "2026-03-27T10:00:00Z" {
					t.Errorf("RequestedAt = %q, want %q", pa.GetRequestedAt(), "2026-03-27T10:00:00Z")
				}
			}
		})
	}
}

// TestProjectToolCallCopiesToolKind verifies the harness-agnostic tool_kind is
// denormalized onto the pending-approval projection (alongside mcp_server_slug),
// so approval surfaces classify the tool without re-deriving it from the name.
func TestProjectToolCallCopiesToolKind(t *testing.T) {
	tc := makeToolCall("tc1", "StrReplace", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)
	tc.ToolKind = agentexecutionv1.ToolKind_TOOL_KIND_FILE_EDIT
	tc.McpServerSlug = "github"

	got := ComputePendingApprovals([]*agentexecutionv1.AgentMessage{makeAIMessage(tc)}, nil)
	if len(got) != 1 {
		t.Fatalf("got %d pending approvals, want 1", len(got))
	}
	if got[0].GetToolKind() != agentexecutionv1.ToolKind_TOOL_KIND_FILE_EDIT {
		t.Errorf("ToolKind = %v, want TOOL_KIND_FILE_EDIT", got[0].GetToolKind())
	}
	if got[0].GetMcpServerSlug() != "github" {
		t.Errorf("McpServerSlug = %q, want %q", got[0].GetMcpServerSlug(), "github")
	}
}

// TestProjectToolCallCopiesFileChanges verifies the runner's approval-time
// before/after capture (ToolCall.file_changes) is denormalized onto the
// pending-approval projection, so the HITL gate renders an inline diff without
// correlating back to the originating ToolCall (which, for workflow-parent
// approvals, is not co-located with the approval). Mirrors the tool_kind test.
func TestProjectToolCallCopiesFileChanges(t *testing.T) {
	tc := makeToolCall("tc1", "edit_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)
	tc.FileChanges = []*agentexecutionv1.FileChange{
		{
			Path:         "src/app/main.ts",
			ChangeType:   agentexecutionv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY,
			CaptureLevel: agentexecutionv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE,
			Before:       &agentexecutionv1.FileContent{Body: &agentexecutionv1.FileContent_Inline{Inline: "old"}},
			After:        &agentexecutionv1.FileContent{Body: &agentexecutionv1.FileContent_Inline{Inline: "new"}},
		},
	}

	got := ComputePendingApprovals([]*agentexecutionv1.AgentMessage{makeAIMessage(tc)}, nil)
	if len(got) != 1 {
		t.Fatalf("got %d pending approvals, want 1", len(got))
	}
	changes := got[0].GetFileChanges()
	if len(changes) != 1 {
		t.Fatalf("got %d file changes, want 1", len(changes))
	}
	if changes[0].GetPath() != "src/app/main.ts" {
		t.Errorf("FileChange.Path = %q, want %q", changes[0].GetPath(), "src/app/main.ts")
	}
	if changes[0].GetChangeType() != agentexecutionv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY {
		t.Errorf("FileChange.ChangeType = %v, want FILE_CHANGE_TYPE_MODIFY", changes[0].GetChangeType())
	}
	if changes[0].GetBefore().GetInline() != "old" || changes[0].GetAfter().GetInline() != "new" {
		t.Errorf("FileChange before/after = %q/%q, want old/new",
			changes[0].GetBefore().GetInline(), changes[0].GetAfter().GetInline())
	}
}

// TestProjectToolCallSingleGatePerCreateCarriesContent verifies the projection
// shape the Cursor runner persists after its denial-correlation fix: ONE
// WAITING_APPROVAL create carrying its WHOLE_FILE CREATE content. A settled
// (FAILED) tool call for the same file — a leftover the append-only-at-identity
// transcript guard forbids removing — must NOT project a second approval (it is
// not WAITING_APPROVAL), and the create's content must reach the gate so the UI
// renders the new-file diff rather than "No preview available". Mirrors the Java
// PendingApprovalComputerTest case of the same name.
func TestProjectToolCallSingleGatePerCreateCarriesContent(t *testing.T) {
	gated := makeToolCall("tc-create", "write_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)
	gated.FileChanges = []*agentexecutionv1.FileChange{
		{
			Path:         "notes.md",
			ChangeType:   agentexecutionv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
			CaptureLevel: agentexecutionv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE,
			After:        &agentexecutionv1.FileContent{Body: &agentexecutionv1.FileContent_Inline{Inline: "# Notes\n"}},
		},
	}
	settledDuplicate := makeToolCall("tc-create-dup", "write_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)

	got := ComputePendingApprovals([]*agentexecutionv1.AgentMessage{makeAIMessage(gated, settledDuplicate)}, nil)
	if len(got) != 1 {
		t.Fatalf("got %d pending approvals, want 1 (only the WAITING_APPROVAL create projects)", len(got))
	}
	if got[0].GetToolCallId() != "tc-create" {
		t.Errorf("ToolCallId = %q, want %q", got[0].GetToolCallId(), "tc-create")
	}
	changes := got[0].GetFileChanges()
	if len(changes) != 1 {
		t.Fatalf("got %d file changes, want 1", len(changes))
	}
	if changes[0].GetChangeType() != agentexecutionv1.FileChangeType_FILE_CHANGE_TYPE_CREATE {
		t.Errorf("FileChange.ChangeType = %v, want FILE_CHANGE_TYPE_CREATE", changes[0].GetChangeType())
	}
	if changes[0].GetAfter().GetInline() != "# Notes\n" {
		t.Errorf("FileChange.After = %q, want %q", changes[0].GetAfter().GetInline(), "# Notes\n")
	}
	if changes[0].GetBefore() != nil {
		t.Errorf("FileChange.Before = %v, want nil for a create", changes[0].GetBefore())
	}
}

// TestProjectToolCallCollapsedTwinProjectsSingleGateWithBeforeAfter locks the
// projection shape the Cursor runner persists after its duplicate-collapse fix:
// one WAITING_APPROVAL edit carrying a WHOLE_FILE before/after MODIFY (the
// reported whole-file-rewrite case), beside a same-resource twin the runner
// collapsed IN PLACE to a content-less SKIPPED row (it cannot drop the committed
// id). The SKIPPED twin must NOT project a second approval, and the gate's real
// before/after must reach the card. Mirrors the Java PendingApprovalComputerTest
// case of the same name.
func TestProjectToolCallCollapsedTwinProjectsSingleGateWithBeforeAfter(t *testing.T) {
	gated := makeToolCall("tc-edit", "edit", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)
	gated.FileChanges = []*agentexecutionv1.FileChange{
		{
			Path:         "notes.md",
			ChangeType:   agentexecutionv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY,
			CaptureLevel: agentexecutionv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE,
			Before:       &agentexecutionv1.FileContent{Body: &agentexecutionv1.FileContent_Inline{Inline: "one\ntwo\n"}},
			After:        &agentexecutionv1.FileContent{Body: &agentexecutionv1.FileContent_Inline{Inline: "alpha\nbeta\n"}},
		},
	}
	// The collapsed twin: SKIPPED, no longer requires approval.
	collapsedTwin := makeToolCall("tc-edit-dup", "edit", agentexecutionv1.ToolCallStatus_TOOL_CALL_SKIPPED, false, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)

	got := ComputePendingApprovals([]*agentexecutionv1.AgentMessage{makeAIMessage(gated, collapsedTwin)}, nil)
	if len(got) != 1 {
		t.Fatalf("got %d pending approvals, want 1 (only the WAITING_APPROVAL edit projects; the SKIPPED twin must not)", len(got))
	}
	if got[0].GetToolCallId() != "tc-edit" {
		t.Errorf("ToolCallId = %q, want %q", got[0].GetToolCallId(), "tc-edit")
	}
	changes := got[0].GetFileChanges()
	if len(changes) != 1 {
		t.Fatalf("got %d file changes, want 1", len(changes))
	}
	if changes[0].GetChangeType() != agentexecutionv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY {
		t.Errorf("FileChange.ChangeType = %v, want FILE_CHANGE_TYPE_MODIFY", changes[0].GetChangeType())
	}
	if changes[0].GetBefore().GetInline() != "one\ntwo\n" {
		t.Errorf("FileChange.Before = %q, want %q", changes[0].GetBefore().GetInline(), "one\ntwo\n")
	}
	if changes[0].GetAfter().GetInline() != "alpha\nbeta\n" {
		t.Errorf("FileChange.After = %q, want %q", changes[0].GetAfter().GetInline(), "alpha\nbeta\n")
	}
}

// TestProjectToolCallNoFileChangesStaysEmpty verifies a non-file tool projects an
// empty file_changes list (the gate falls back to the args preview).
func TestProjectToolCallNoFileChangesStaysEmpty(t *testing.T) {
	tc := makeToolCall("tc1", "execute_sql", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)

	got := ComputePendingApprovals([]*agentexecutionv1.AgentMessage{makeAIMessage(tc)}, nil)
	if len(got) != 1 {
		t.Fatalf("got %d pending approvals, want 1", len(got))
	}
	if len(got[0].GetFileChanges()) != 0 {
		t.Errorf("FileChanges = %d, want 0 for a non-file tool", len(got[0].GetFileChanges()))
	}
}

// TestProjectToolCallCopiesSubAgentSubject locks the Go projection to the Java
// PendingApprovalComputer: a sub-agent approval must carry the sub-agent's task
// subject so approval surfaces label the card with the task instead of the
// generic agent type. Before this was fixed the Go side dropped the field,
// producing a live cross-edition divergence (OSS empty, Cloud populated) that
// the shared HITL fixture corpus depends on being resolved.
func TestProjectToolCallCopiesSubAgentSubject(t *testing.T) {
	subAgents := []*agentexecutionv1.SubAgentExecution{
		{
			Name:    "code-reviewer",
			Subject: "Explore CLI rendering code",
			Status:  agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS,
			Messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(
					makeToolCall("tc-sub1", "run_tests", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
				),
			},
		},
	}

	got := ComputePendingApprovals(nil, subAgents)
	if len(got) != 1 {
		t.Fatalf("got %d pending approvals, want 1", len(got))
	}
	if !got[0].GetFromSubAgent() {
		t.Errorf("FromSubAgent = false, want true")
	}
	if got[0].GetSubAgentName() != "code-reviewer" {
		t.Errorf("SubAgentName = %q, want %q", got[0].GetSubAgentName(), "code-reviewer")
	}
	if got[0].GetSubAgentSubject() != "Explore CLI rendering code" {
		t.Errorf("SubAgentSubject = %q, want %q", got[0].GetSubAgentSubject(), "Explore CLI rendering code")
	}
}

// TestProjectToolCallRootHasNoSubAgentSubject verifies a root tool call leaves
// sub_agent_subject empty (the field is sub-agent-only).
func TestProjectToolCallRootHasNoSubAgentSubject(t *testing.T) {
	tc := makeToolCall("tc1", "deploy", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)

	got := ComputePendingApprovals([]*agentexecutionv1.AgentMessage{makeAIMessage(tc)}, nil)
	if len(got) != 1 {
		t.Fatalf("got %d pending approvals, want 1", len(got))
	}
	if got[0].GetSubAgentSubject() != "" {
		t.Errorf("SubAgentSubject = %q, want empty for a root tool call", got[0].GetSubAgentSubject())
	}
}
