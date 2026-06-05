package agentexecution

import (
	"context"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

// Verifies the shared phase step cascades sub-agent cancellation for both
// CANCELLED and TERMINATED transitions, and leaves them alone for non-terminal
// transitions like PAUSED.
func TestUpdateExecutionPhaseStep_CascadesSubAgentsOnTerminal(t *testing.T) {
	cases := []struct {
		name        string
		targetPhase agentexecutionv1.ExecutionPhase
		setError    bool
		wantCascade bool
	}{
		{"cancel cascades", agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, false, true},
		{"terminate cascades", agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, true, true},
		{"pause does not cascade", agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, false, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			exec := &agentexecutionv1.AgentExecution{
				Status: &agentexecutionv1.AgentExecutionStatus{
					Phase: agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
					SubAgentExecutions: []*agentexecutionv1.SubAgentExecution{
						{Id: "s1", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS},
						{Id: "s2", Status: agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED},
					},
				},
			}

			reqCtx := pipeline.NewRequestContext(context.Background(),
				&agentexecutionv1.CancelAgentExecutionInput{Id: "aex_test"})
			reqCtx.Set(LoadedExecutionKey, exec)

			step := NewUpdateExecutionPhaseStep[*agentexecutionv1.CancelAgentExecutionInput](
				tc.targetPhase, tc.setError, false)
			require.NoError(t, step.Execute(reqCtx))

			assert.Equal(t, tc.targetPhase, exec.Status.Phase)

			s1 := exec.Status.SubAgentExecutions[0]
			if tc.wantCascade {
				assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED, s1.GetStatus(),
					"in-flight sub-agent should be CANCELLED on %s", tc.targetPhase)
				assert.NotEmpty(t, s1.GetCompletedAt())
			} else {
				assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS, s1.GetStatus(),
					"sub-agent must not be cancelled on a non-terminal transition")
			}

			// COMPLETED sub-agent is always preserved.
			assert.Equal(t, agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED,
				exec.Status.SubAgentExecutions[1].GetStatus())
		})
	}
}
