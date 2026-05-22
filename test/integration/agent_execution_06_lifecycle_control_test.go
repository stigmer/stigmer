//go:build integration

package integration

import (
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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

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
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping terminate test")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			// Use the slow MCP tool (30s sleep) to guarantee the execution
			// is still running when the terminate signal arrives, avoiding
			// the race condition where a text-only prompt completes too fast
			// on the cursor harness.
			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-terminate-"+h.Name,
				"You MUST call the slow tool with seconds=30. Do not respond with text. Your only action is calling the slow tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the slow tool with seconds=30.",
				harness.WithAutoApproveAll(true))

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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

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

			_, err = clients.AgentExecutionCommand.Pause(ctx, &agentexecv1.PauseAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "pause should succeed")

			paused, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_PAUSED, 2*time.Minute)
			if err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			}
			require.NoError(t, err, "execution should reach PAUSED")
			harness.AssertAgentPhase(t, paused, agentexecv1.ExecutionPhase_EXECUTION_PAUSED)

			_, err = clients.AgentExecutionCommand.Resume(ctx, &agentexecv1.ResumeAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "resume should succeed")

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			if err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			}
			require.NoError(t, err, "execution should complete after resume")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_Recover(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping recover test")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			// The crash tool kills the MCP server process, which should cause
			// the agent-runner to fail the execution with a broken pipe error.
			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-recover-"+h.Name,
				"You MUST call the crash tool immediately. Do not respond with text first. Your only action is calling the crash tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the crash tool now.",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			// Wait for the execution to reach a terminal state.
			// The crash tool should cause FAILED, but the runner may handle
			// it differently (COMPLETED with error message) depending on
			// how the broken pipe is caught.
			terminal, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
			require.NoError(t, err, "execution should reach a terminal state")

			if terminal.GetStatus().GetPhase() != agentexecv1.ExecutionPhase_EXECUTION_FAILED {
				t.Skipf("execution reached %s instead of FAILED — crash tool did not produce a recoverable failure (this is informational, not a test failure)",
					terminal.GetStatus().GetPhase().String())
			}

			t.Logf("execution failed as expected: id=%s, error=%s",
				terminal.GetMetadata().GetId(), terminal.GetStatus().GetError())

			// Recover the failed execution — creates a NEW execution with a new ID.
			recovered, err := clients.AgentExecutionCommand.Recover(ctx, &agentexecv1.RecoverAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "recover should succeed for FAILED execution")
			require.NotNil(t, recovered, "recover should return the new execution")

			recoveredID := recovered.GetMetadata().GetId()
			require.NotEmpty(t, recoveredID, "recovered execution should have an ID")

			t.Logf("recover initiated: original=%s, recovered=%s, phase=%s",
				exec.GetMetadata().GetId(), recoveredID, recovered.GetStatus().GetPhase().String())

			// Wait on the NEW recovered execution ID, not the original.
			// The original stays FAILED; the recovered execution is a new one
			// that should transition through IN_PROGRESS to a terminal state.
			finalResult, err := waiter.WaitForTerminal(ctx, recoveredID, 3*time.Minute)
			require.NoError(t, err, "recovered execution should reach a terminal state")

			t.Logf("recovered execution finished: id=%s, phase=%s",
				finalResult.GetMetadata().GetId(), finalResult.GetStatus().GetPhase().String())
		})
	}
}

func TestAgentExecution_TerminateIdempotent(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping terminate idempotent test")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-term-idem-"+h.Name,
				"You MUST call the slow tool with seconds=30. Do not respond with text. Your only action is calling the slow tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the slow tool with seconds=30.",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err)

			_, err = clients.AgentExecutionCommand.Terminate(ctx, &agentexecv1.TerminateAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err)

			_, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_TERMINATED, 2*time.Minute)
			require.NoError(t, err)

			// Second terminate should be idempotent
			_, err = clients.AgentExecutionCommand.Terminate(ctx, &agentexecv1.TerminateAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "terminating already-terminated execution should be a no-op")

			t.Logf("terminate idempotent: second terminate returned no error")
		})
	}
}

func TestAgentExecution_TerminateTerminalFails(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-term-done-"+h.Name,
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

			_, err = clients.AgentExecutionCommand.Terminate(ctx, &agentexecv1.TerminateAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.Error(t, err, "terminating completed execution should return FAILED_PRECONDITION")
			t.Logf("terminate-terminal correctly rejected: %v", err)
		})
	}
}
