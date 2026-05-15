//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

func TestAgentExecution_SubAgent_Delegation(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-subagent-"+h.Name,
				"You are a project manager. When asked to research a topic, delegate to the researcher sub-agent using the task tool.",
				harness.WithSubAgent(&agentv1.SubAgent{
					Name:         "researcher",
					Description:  "Researches topics and provides summaries",
					Instructions: "You are a researcher. When given a topic, provide a brief 2-3 sentence summary. Be concise.",
				}),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please delegate to the researcher to give a brief summary about renewable energy.")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			subAgents := result.GetStatus().GetSubAgentExecutions()
			if len(subAgents) > 0 {
				t.Logf("sub-agent executions found: %d", len(subAgents))
				for _, sa := range subAgents {
					t.Logf("  sub-agent: name=%s, status=%s, messages=%d",
						sa.GetName(), sa.GetStatus().String(), len(sa.GetMessages()))
				}
			} else {
				t.Log("no sub-agent executions recorded (agent may have answered directly)")
			}
		})
	}
}

func TestAgentExecution_SubAgent_ParentCancelCascade(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-subagent-cancel-"+h.Name,
				"You are a project manager. Delegate to the researcher sub-agent to write a very long comprehensive report about the history of the internet.",
				harness.WithSubAgent(&agentv1.SubAgent{
					Name:         "researcher",
					Description:  "Writes detailed reports",
					Instructions: "You are a researcher. Write a very detailed, comprehensive report with at least 10 sections. Take your time and be thorough.",
				}),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Delegate to the researcher to write a very long comprehensive report about the history of the internet.")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err)

			// Give some time for sub-agent to start
			time.Sleep(5 * time.Second)

			// Cancel the parent
			_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "cancel should succeed")

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
			require.NoError(t, err, "execution should reach CANCELLED")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_CANCELLED)

			// If sub-agents were active, they should be cancelled too
			for _, sa := range result.GetStatus().GetSubAgentExecutions() {
				if sa.GetStatus() == agentexecv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS {
					t.Errorf("sub-agent %q still IN_PROGRESS after parent cancellation", sa.GetName())
				}
			}
		})
	}
}
