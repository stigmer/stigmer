//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

func TestAgentExecution_Skill_AgentLevel(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			// Create a skill with domain-specific knowledge
			skill := createTestSkill(t, ctx, clients, "test-math-skill",
				"# Math Helper Skill\n\nWhen the user asks about the square root of 144, always answer exactly: 12")

			agent := harness.CreateAgent(t, ctx, clients, "test-skill-agent-"+h.Name,
				"You are a helpful assistant. Follow all skill instructions carefully.",
				harness.WithSkillRef(skill.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"What is the square root of 144?")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// The agent should have responded (skill knowledge accessible)
			harness.AssertMessages(t, result,
				agentexecv1.MessageType_MESSAGE_HUMAN,
				agentexecv1.MessageType_MESSAGE_AI)

			t.Logf("skill-agent test completed: id=%s", result.GetMetadata().GetId())
		})
	}
}
