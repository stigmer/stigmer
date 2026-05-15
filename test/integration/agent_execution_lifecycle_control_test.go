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

func TestAgentExecution_Cancel(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-cancel-"+h.Name,
				"You are a helpful assistant. When asked, write a very long detailed essay about the history of computing. Make it at least 2000 words.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Write a very long detailed essay about the history of computing.")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			// Wait until execution is in progress
			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err, "execution should reach IN_PROGRESS")

			// Cancel it
			_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "cancel should succeed")

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
			require.NoError(t, err, "execution should reach CANCELLED")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_CANCELLED)
		})
	}
}

func TestAgentExecution_CancelIdempotent(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-cancel-idem-"+h.Name,
				"You are a helpful assistant. Write a long essay about space exploration.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Write a long essay about space exploration.")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err)

			_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err)

			_, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
			require.NoError(t, err)

			// Cancel again — should be idempotent
			_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "cancelling already-cancelled execution should be a no-op")
		})
	}
}

func TestAgentExecution_CancelTerminalFails(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-cancel-term-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err)

			// Cancelling a completed execution should fail
			_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.Error(t, err, "cancelling completed execution should return FAILED_PRECONDITION")
			t.Logf("cancel-terminal correctly rejected: %v", err)
		})
	}
}

func TestAgentExecution_Terminate(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-terminate-"+h.Name,
				"You are a helpful assistant. Write a very long detailed essay about artificial intelligence history.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Write a very long detailed essay about artificial intelligence history.")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err)

			_, err = clients.AgentExecutionCommand.Terminate(ctx, &agentexecv1.TerminateAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "terminate should succeed")

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_TERMINATED, 2*time.Minute)
			require.NoError(t, err, "execution should reach TERMINATED")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_TERMINATED)
		})
	}
}

func TestAgentExecution_Pause_Resume(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-pause-resume-"+h.Name,
				"You are a helpful assistant. Write a detailed essay about quantum computing.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Write a detailed essay about quantum computing. Include at least 5 paragraphs.")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err)

			// Pause
			_, err = clients.AgentExecutionCommand.Pause(ctx, &agentexecv1.PauseAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "pause should succeed")

			paused, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_PAUSED, 2*time.Minute)
			require.NoError(t, err, "execution should reach PAUSED")
			harness.AssertAgentPhase(t, paused, agentexecv1.ExecutionPhase_EXECUTION_PAUSED)

			// Resume
			_, err = clients.AgentExecutionCommand.Resume(ctx, &agentexecv1.ResumeAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "resume should succeed")

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete after resume")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}
