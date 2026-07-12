package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stretchr/testify/assert"
)

func TestCancelInProgressSubAgents(t *testing.T) {
	subAgents := []*agentexecutionv1.SubAgentExecution{
		{Id: "a", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS},
		{Id: "b", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_PENDING},
		{Id: "c", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED, CompletedAt: "2026-01-01T00:00:00Z"},
		{Id: "d", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS, CompletedAt: "preexisting"},
	}

	cancelInProgressSubAgents(subAgents, "2026-06-05T00:00:00Z")

	// IN_PROGRESS -> CANCELLED, completed_at filled in.
	assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED, subAgents[0].GetStatus())
	assert.Equal(t, "2026-06-05T00:00:00Z", subAgents[0].GetCompletedAt())

	// PENDING -> CANCELLED.
	assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED, subAgents[1].GetStatus())

	// COMPLETED is terminal — untouched.
	assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED, subAgents[2].GetStatus())
	assert.Equal(t, "2026-01-01T00:00:00Z", subAgents[2].GetCompletedAt())

	// IN_PROGRESS with an existing completed_at is cancelled but the timestamp is preserved.
	assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED, subAgents[3].GetStatus())
	assert.Equal(t, "preexisting", subAgents[3].GetCompletedAt())
}

func TestCancelInProgressSubAgents_NilSafe(t *testing.T) {
	assert.NotPanics(t, func() {
		cancelInProgressSubAgents(nil, "2026-06-05T00:00:00Z")
		cancelInProgressSubAgents([]*agentexecutionv1.SubAgentExecution{nil}, "2026-06-05T00:00:00Z")
	})
}

// newTransitionFixture builds an IN_PROGRESS execution that carries every field
// applyLifecyclePhaseTransition can touch (completed_at, error, an in-flight +
// a completed sub-agent, an in-flight + a completed tool call, and a pending
// approval), so each case can assert both what changes and what is left alone.
func newTransitionFixture() *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:       agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			CompletedAt: "2026-01-01T00:00:00Z",
			Error:       "preexisting error",
			Messages: []*agentexecutionv1.AgentMessage{
				{Type: agentexecutionv1.MessageType_MESSAGE_AI, ToolCalls: []*agentexecutionv1.ToolCall{
					{Id: "tc-running", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING},
					{Id: "tc-done", Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED},
				}},
			},
			SubAgentExecutions: []*agentexecutionv1.SubAgentExecution{
				{Id: "s1", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS},
				{Id: "s2", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED},
			},
			PendingApprovals: []*agentexecutionv1.PendingApproval{{}},
		},
	}
}

// Locks the full behavior of applyLifecyclePhaseTransition across every lifecycle
// op. This is the pure mutation that runs inside the
// UpdateExecutionPhaseAndPersistStep's atomic store.UpdateResource closure, so
// testing it directly is the highest-value unit of the lifecycle persist path.
func TestApplyLifecyclePhaseTransition(t *testing.T) {
	t.Run("pause: non-terminal, keeps completed_at/pending/sub-agents/error", func(t *testing.T) {
		exec := newTransitionFixture()
		applyLifecyclePhaseTransition(exec, agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, false, false, "")

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, exec.Status.Phase)
		assert.Equal(t, "2026-01-01T00:00:00Z", exec.Status.CompletedAt, "PAUSED is not terminal; completed_at untouched")
		assert.Equal(t, "preexisting error", exec.Status.Error)
		assert.Len(t, exec.Status.PendingApprovals, 1, "pending must survive a pause (it can resume)")
		assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS, exec.Status.SubAgentExecutions[0].GetStatus())
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING,
			exec.Status.Messages[0].ToolCalls[0].GetStatus(), "PAUSED is not terminal; in-flight tool calls untouched")
	})

	t.Run("resume: IN_PROGRESS clears completed_at, keeps error and pending", func(t *testing.T) {
		exec := newTransitionFixture()
		exec.Status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED
		applyLifecyclePhaseTransition(exec, agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, false, false, "")

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, exec.Status.Phase)
		assert.Empty(t, exec.Status.CompletedAt, "IN_PROGRESS clears completed_at")
		assert.Equal(t, "preexisting error", exec.Status.Error, "resume does not clear error")
		assert.Len(t, exec.Status.PendingApprovals, 1)
	})

	t.Run("recover: IN_PROGRESS clears completed_at and error", func(t *testing.T) {
		exec := newTransitionFixture()
		exec.Status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_FAILED
		applyLifecyclePhaseTransition(exec, agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, false, true, "")

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, exec.Status.Phase)
		assert.Empty(t, exec.Status.CompletedAt)
		assert.Empty(t, exec.Status.Error, "recover clears error")
	})

	t.Run("cancel: terminal sets completed_at, cascades, clears pending", func(t *testing.T) {
		exec := newTransitionFixture()
		applyLifecyclePhaseTransition(exec, agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, false, false, "")

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, exec.Status.Phase)
		assert.NotEmpty(t, exec.Status.CompletedAt)
		assert.Nil(t, exec.Status.PendingApprovals, "a terminal execution carries no pending approvals")
		assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED, exec.Status.SubAgentExecutions[0].GetStatus(),
			"in-flight sub-agent cascaded to CANCELLED")
		assert.NotEmpty(t, exec.Status.SubAgentExecutions[0].GetCompletedAt())
		assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED, exec.Status.SubAgentExecutions[1].GetStatus(),
			"already-COMPLETED sub-agent preserved")
		assert.Equal(t, "preexisting error", exec.Status.Error, "cancel does not set error")
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED,
			exec.Status.Messages[0].ToolCalls[0].GetStatus(), "in-flight tool call settled to INTERRUPTED")
		assert.NotEmpty(t, exec.Status.Messages[0].ToolCalls[0].GetCompletedAt())
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED,
			exec.Status.Messages[0].ToolCalls[1].GetStatus(), "already-terminal tool call preserved")
	})

	t.Run("terminate: sets error from reason, cascades, clears pending", func(t *testing.T) {
		exec := newTransitionFixture()
		applyLifecyclePhaseTransition(exec, agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, true, false, "disk full")

		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, exec.Status.Phase)
		assert.NotEmpty(t, exec.Status.CompletedAt)
		assert.Nil(t, exec.Status.PendingApprovals)
		assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED, exec.Status.SubAgentExecutions[0].GetStatus())
		assert.Equal(t, "Terminated: disk full", exec.Status.Error)
		assert.Equal(t, agentexecutionv1.ToolCallStatus_TOOL_CALL_INTERRUPTED,
			exec.Status.Messages[0].ToolCalls[0].GetStatus(), "force-kill settles in-flight tool calls")
	})

	t.Run("terminate: empty reason falls back to default error", func(t *testing.T) {
		exec := newTransitionFixture()
		applyLifecyclePhaseTransition(exec, agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, true, false, "")

		assert.Equal(t, "Terminated by user", exec.Status.Error)
	})

	t.Run("nil status is initialized", func(t *testing.T) {
		exec := &agentexecutionv1.AgentExecution{}
		applyLifecyclePhaseTransition(exec, agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, false, false, "")

		assert.NotNil(t, exec.Status)
		assert.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, exec.Status.Phase)
	})
}
