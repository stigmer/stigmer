//go:build integration

package integration

import (
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCursorHarness_HITL_WriteGate_Approve is the end-to-end proof that the
// Cursor harness human-in-the-loop gate works for a built-in mutating tool.
//
// It exercises the full loop the platform previously could not:
//  1. Agent proposes a Write (a gated built-in tool).
//  2. The preToolUse hook denies it; the execution surfaces
//     WAITING_FOR_APPROVAL with a pending approval for the Write.
//  3. The user submits APPROVE.
//  4. The workflow reinvokes the activity; the tool-identity grant lets the
//     re-attempted Write through and the execution completes.
//
// This is the scenario that motivated the work: "writing a file should have a
// human-in-the-loop gate." Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_WriteGate_Approve(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-write-approve",
		"You are a precise coding assistant. When asked to create a file, use the "+
			"Write tool exactly once to create it, then stop. Do not respond with text only.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// auto_approve_all=false → the Write must pause at the approval gate.
	exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called gated.txt containing exactly the text: hello-hitl. "+
			"Use the Write tool to create it.",
		3*time.Minute,
		harness.WithAutoApproveAll(false),
	)

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	require.NotEmpty(t, waiting.GetStatus().GetPendingApprovals(),
		"cursor harness should surface a pending approval for the gated Write tool")

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	t.Logf("pending approval: tool=%s, id=%s, message=%q",
		approval.GetToolName(), approval.GetToolCallId(), approval.GetMessage())
	assert.True(t, isGatedBuiltIn(approval.GetToolName()),
		"expected a gated built-in tool (Write/StrReplace/EditNotebook/Shell/Delete), got %q",
		approval.GetToolName())

	// Load-bearing invariant: the backend projects pending_approvals from
	// tool-call status, so the gated Write must itself carry WAITING_APPROVAL
	// (not COMPLETED). This is the exact regression that hid the approval gate.
	assertToolCallWaitingApproval(t, waiting, approval.GetToolCallId())

	// Approve and let the reinvocation grant carry the re-attempted Write through.
	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		3*time.Minute,
	)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete after the Write is approved")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// The approved Write must have actually executed on the resumed turn — proving
	// the grant let the re-attempt (with a fresh tool-call id) through.
	assertCompletedWrite(t, result)
}

// TestCursorHarness_HITL_AutoApproveAll_NoGate verifies the bypass: with
// auto_approve_all=true the same Write executes without ever pausing for
// approval. Requires CURSOR_API_KEY.
func TestCursorHarness_HITL_AutoApproveAll_NoGate(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := createTestAgentForCursor(t, ctx, clients,
		"test-cursor-hitl-write-autoapprove",
		"You are a precise coding assistant. When asked to create a file, use the "+
			"Write tool exactly once to create it, then stop.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
	)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Create a file called auto.txt containing exactly the text: hello-auto. "+
			"Use the Write tool to create it.",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
	}
	require.NoError(t, err, "execution should complete directly with auto_approve_all")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// No approval should ever have been surfaced.
	assert.Empty(t, result.GetStatus().GetPendingApprovals(),
		"auto_approve_all=true must not surface any approval gate")
	assertCompletedWrite(t, result)
}

// assertToolCallWaitingApproval asserts the gated tool call carries
// TOOL_CALL_WAITING_APPROVAL + requires_approval. The backend's
// PendingApprovalComputer projects pending_approvals from exactly this status,
// so this is the invariant that makes the approval gate surface at all.
func assertToolCallWaitingApproval(t *testing.T, exec *agentexecv1.AgentExecution, toolCallID string) {
	t.Helper()
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetId() != toolCallID {
				continue
			}
			assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, tc.GetStatus(),
				"gated tool call %s must be WAITING_APPROVAL (drives the pending_approvals projection)", toolCallID)
			assert.True(t, tc.GetRequiresApproval(),
				"gated tool call %s must have requires_approval=true", toolCallID)
			return
		}
	}
	t.Errorf("tool call %s not found in waiting execution messages", toolCallID)
}

// isGatedBuiltIn reports whether a tool name is one of the cursor harness's
// gated built-in tools (kept in sync with approval-policy.ts BUILT_IN_GATED).
func isGatedBuiltIn(name string) bool {
	switch name {
	case "Write", "StrReplace", "EditNotebook", "Shell", "Delete":
		return true
	default:
		return false
	}
}

// assertCompletedWrite asserts the persisted messages contain a write-like tool
// call that completed (not stuck WAITING_APPROVAL/RUNNING).
func assertCompletedWrite(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	for _, tc := range collectToolCalls(exec.GetStatus().GetMessages()) {
		name := strings.ToLower(tc.GetName())
		isWrite := strings.Contains(name, "write") || strings.Contains(name, "edit") ||
			name == "strreplace"
		if isWrite && tc.GetStatus() == agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED {
			t.Logf("approved write executed: tool=%s, status=%s", tc.GetName(), tc.GetStatus())
			return
		}
	}
	t.Errorf("expected a COMPLETED write tool call in persisted messages; none found")
}
