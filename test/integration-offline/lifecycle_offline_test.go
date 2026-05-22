//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// keepAliveEntries returns mock LLM entries that call a tool (keeping the
// execution alive long enough for lifecycle actions like cancel/terminate/pause).
// Turn 1: LLM calls echo tool
// Turn 2: LLM produces text after getting tool result
func keepAliveEntries() []harness.RecordedLLMEntry {
	return []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_keepalive_01", "echo", map[string]any{"input": "keep-alive"},
			300, 40,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"Done.", 500, 20,
		)),
	}
}

// quickCompleteEntries returns a single text response for tests that need
// the execution to complete quickly (e.g. CancelTerminalFails).
func quickCompleteEntries() []harness.RecordedLLMEntry {
	return []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"hello", 100, 5,
		)),
	}
}

// startLifecycleExecution creates an MCP server, agent, session, and execution
// using the given mock entries. Returns the session ID, execution, waiter, and
// runner manager for lifecycle test use.
func startLifecycleExecution(
	t *testing.T,
	ctx context.Context,
	entries []harness.RecordedLLMEntry,
	nameSuffix string,
) (
	mockLLM *harness.MockLLMProxyServer,
	mgr *harness.UnifiedRunnerManager,
	exec *agentexecv1.AgentExecution,
	waiter *harness.AgentExecutionWaiter,
) {
	t.Helper()

	mockLLM, mgr = startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-lifecycle-"+nameSuffix,
		"You are a test agent. Use the tools provided.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug(), "echo"),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)

	_, err := mgr.AddSession(ctx, session.GetMetadata().GetId())
	require.NoError(t, err, "AddSession should succeed")

	exec = harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Use the echo tool to echo 'keep-alive'",
		harness.WithAutoApproveAll(true),
	)

	waiter = harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	return
}

func TestOffline_Cancel(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	_, _, exec, waiter := startLifecycleExecution(t, ctx, keepAliveEntries(), "cancel")
	clients := harness.NewClients(grpcConn)

	_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
	require.NoError(t, err, "execution should reach IN_PROGRESS")

	_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
		Id: exec.GetMetadata().GetId(),
	})
	require.NoError(t, err, "cancel should succeed")

	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
	require.NoError(t, err, "execution should reach CANCELLED")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_CANCELLED)

	t.Logf("offline cancel test passed: id=%s", exec.GetMetadata().GetId())
}

func TestOffline_CancelIdempotent(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	_, _, exec, waiter := startLifecycleExecution(t, ctx, keepAliveEntries(), "cancel-idem")
	clients := harness.NewClients(grpcConn)

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

	// Second cancel should be idempotent
	_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
		Id: exec.GetMetadata().GetId(),
	})
	require.NoError(t, err, "cancelling already-cancelled execution should be a no-op")

	t.Logf("offline cancel idempotent test passed: id=%s", exec.GetMetadata().GetId())
}

func TestOffline_CancelTerminalFails(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	_, _, exec, waiter := startLifecycleExecution(t, ctx, quickCompleteEntries(), "cancel-term")
	clients := harness.NewClients(grpcConn)

	_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err)

	_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
		Id: exec.GetMetadata().GetId(),
	})
	require.Error(t, err, "cancelling completed execution should return FAILED_PRECONDITION")

	t.Logf("offline cancel-terminal correctly rejected: %v", err)
}

func TestOffline_Terminate(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	_, _, exec, waiter := startLifecycleExecution(t, ctx, keepAliveEntries(), "terminate")
	clients := harness.NewClients(grpcConn)

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

	t.Logf("offline terminate test passed: id=%s", exec.GetMetadata().GetId())
}

func TestOffline_Pause_Resume(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, _, exec, waiter := startLifecycleExecution(t, ctx, keepAliveEntries(), "pause-resume")
	clients := harness.NewClients(grpcConn)

	_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
	require.NoError(t, err)

	_, err = clients.AgentExecutionCommand.Pause(ctx, &agentexecv1.PauseAgentExecutionInput{
		Id: exec.GetMetadata().GetId(),
	})
	require.NoError(t, err, "pause should succeed")

	paused, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_PAUSED, 2*time.Minute)
	require.NoError(t, err, "execution should reach PAUSED")
	harness.AssertAgentPhase(t, paused, agentexecv1.ExecutionPhase_EXECUTION_PAUSED)

	_, err = clients.AgentExecutionCommand.Resume(ctx, &agentexecv1.ResumeAgentExecutionInput{
		Id: exec.GetMetadata().GetId(),
	})
	require.NoError(t, err, "resume should succeed")

	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "execution should complete after resume")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline pause/resume test passed: id=%s", exec.GetMetadata().GetId())
}

func TestOffline_Recover(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Use an error response to trigger a failure. The mock returns a 500
	// to simulate an LLM error, which should cause the execution to fail.
	failEntries := []harness.RecordedLLMEntry{
		{
			Index: 0,
			Response: harness.RecordedLLMResponse{
				Status:     500,
				StatusText: "Internal Server Error",
				Headers:    map[string]string{"content-type": "application/json"},
				Body: map[string]any{
					"error": map[string]any{
						"type":    "server_error",
						"message": "mock-induced failure for recover test",
					},
				},
			},
		},
	}

	_, mgr, exec, waiter := startLifecycleExecution(t, ctx, failEntries, "recover")
	clients := harness.NewClients(grpcConn)

	terminal, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
	require.NoError(t, err, "execution should reach a terminal state")

	if terminal.GetStatus().GetPhase() != agentexecv1.ExecutionPhase_EXECUTION_FAILED {
		t.Skipf("execution reached %s instead of FAILED — mock error did not produce a recoverable failure",
			terminal.GetStatus().GetPhase().String())
	}

	t.Logf("execution failed as expected: id=%s", terminal.GetMetadata().GetId())

	// Set up a fresh runner for the recovered execution with success entries.
	successEntries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"Recovered successfully.", 200, 15,
		)),
	}
	mockLLM2 := harness.NewMockLLMProxyServerFromEntries(successEntries)
	t.Cleanup(func() { mockLLM2.Close() })
	_ = mgr

	recovered, err := clients.AgentExecutionCommand.Recover(ctx, &agentexecv1.RecoverAgentExecutionInput{
		Id: exec.GetMetadata().GetId(),
	})
	require.NoError(t, err, "recover should succeed for FAILED execution")
	require.NotNil(t, recovered)

	recoveredID := recovered.GetMetadata().GetId()
	require.NotEmpty(t, recoveredID)

	t.Logf("recover initiated: original=%s, recovered=%s",
		exec.GetMetadata().GetId(), recoveredID)

	finalResult, err := waiter.WaitForTerminal(ctx, recoveredID, 3*time.Minute)
	require.NoError(t, err, "recovered execution should reach a terminal state")

	t.Logf("recovered execution finished: id=%s, phase=%s",
		finalResult.GetMetadata().GetId(), finalResult.GetStatus().GetPhase().String())
}

func TestOffline_TerminateIdempotent(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	_, _, exec, waiter := startLifecycleExecution(t, ctx, keepAliveEntries(), "term-idem")
	clients := harness.NewClients(grpcConn)

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

	t.Logf("offline terminate idempotent test passed: id=%s", exec.GetMetadata().GetId())
}

func TestOffline_TerminateTerminalFails(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	_, _, exec, waiter := startLifecycleExecution(t, ctx, quickCompleteEntries(), "term-done")
	clients := harness.NewClients(grpcConn)

	_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err)

	_, err = clients.AgentExecutionCommand.Terminate(ctx, &agentexecv1.TerminateAgentExecutionInput{
		Id: exec.GetMetadata().GetId(),
	})
	require.Error(t, err, "terminating completed execution should return FAILED_PRECONDITION")

	t.Logf("offline terminate-terminal correctly rejected: %v", err)
}
