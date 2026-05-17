//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
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
			harness.RequireServiceHealthy(t, ctx, clients)

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
			if err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			}
			require.NoError(t, err, "execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			harness.AssertMessages(t, result,
				agentexecv1.MessageType_MESSAGE_AI)

			t.Logf("skill-agent test completed: id=%s", result.GetMetadata().GetId())
		})
	}
}

func TestAgentExecution_Skill_SessionLevel(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			// Agent-level skill: provides math knowledge.
			agentSkill := createTestSkill(t, ctx, clients, "test-agent-math",
				"# Agent Math Skill\n\nWhen asked about the square root of 256, answer exactly: 16")

			// Session-level skill: provides geography knowledge.
			sessionSkill := createTestSkill(t, ctx, clients, "test-session-geo",
				"# Session Geography Skill\n\nWhen asked about the capital of France, answer exactly: Paris")

			agent := harness.CreateAgent(t, ctx, clients, "test-skill-session-"+h.Name,
				"You are a helpful assistant. Follow ALL skill instructions carefully. Answer questions using the knowledge from your skills.",
				harness.WithSkillRef(agentSkill.GetMetadata().GetSlug()),
			)

			// Create session with session-level skill_refs.
			sessionName := "test-session-skill-" + uuid.New().String()[:8]
			session, err := clients.SessionCommand.Create(ctx, &sessionv1.Session{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "Session",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: sessionName,
					Org:  "test-org",
				},
				Spec: &sessionv1.SessionSpec{
					AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
					Subject:         "session skill test",
					Harness:         h.Harness,
					SkillRefs: []*apiresource.ApiResourceReference{
						{
							Slug: sessionSkill.GetMetadata().GetSlug(),
							Org:  "test-org",
							Kind: 43, // skill
						},
					},
				},
			})
			require.NoError(t, err, "create session with skill_refs should succeed")
			t.Cleanup(func() {
				cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				clients.SessionCommand.Delete(cleanCtx, &sessionv1.SessionId{Value: session.GetMetadata().GetId()})
			})

			// Ask about geography (from session skill) to verify session
			// skills are merged with agent skills.
			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"What is the capital of France?")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			if err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			}
			require.NoError(t, err, "execution should complete with session-level skill")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			t.Logf("session-level skill test completed: id=%s", result.GetMetadata().GetId())
		})
	}
}

func TestAgentExecution_Skill_Deduplication(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			// Create ONE skill referenced at both agent and session level.
			// Proto documents dedup by slug -- the skill content should be
			// injected exactly once even though referenced twice.
			skill := createTestSkill(t, ctx, clients, "test-dedup-skill",
				"# Dedup Test Skill\n\nWhen asked how many times this skill was loaded, answer exactly: once")

			agent := harness.CreateAgent(t, ctx, clients, "test-skill-dedup-"+h.Name,
				"You are a helpful assistant. Follow all skill instructions carefully.",
				harness.WithSkillRef(skill.GetMetadata().GetSlug()),
			)

			// Session also references the same skill.
			sessionName := "test-session-dedup-" + uuid.New().String()[:8]
			session, err := clients.SessionCommand.Create(ctx, &sessionv1.Session{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "Session",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: sessionName,
					Org:  "test-org",
				},
				Spec: &sessionv1.SessionSpec{
					AgentInstanceId: agent.GetStatus().GetDefaultInstanceId(),
					Subject:         "skill dedup test",
					Harness:         h.Harness,
					SkillRefs: []*apiresource.ApiResourceReference{
						{
							Slug: skill.GetMetadata().GetSlug(),
							Org:  "test-org",
							Kind: 43, // skill
						},
					},
				},
			})
			require.NoError(t, err, "create session with duplicate skill ref should succeed")
			t.Cleanup(func() {
				cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				clients.SessionCommand.Delete(cleanCtx, &sessionv1.SessionId{Value: session.GetMetadata().GetId()})
			})

			// The execution should complete successfully. If dedup is broken
			// and the skill is injected twice, the agent would still likely
			// complete -- so the primary assertion is that the pipeline does
			// not error on duplicate skill refs.
			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"How many times was the dedup test skill loaded?")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			if err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			}
			require.NoError(t, err, "execution with duplicate skill refs should complete without errors")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			t.Logf("skill dedup test completed: id=%s", result.GetMetadata().GetId())
		})
	}
}
