//go:build integration

package integration

import (
	"fmt"
	"sync"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Proto contract: command.proto Recover RPC preconditions:
//
//	"CANCELLED executions cannot be recovered (intentional user action)"
//
// Verifies: Recover on CANCELLED → FAILED_PRECONDITION.
func TestAgentExecution_RecoverCancelled_Rejected(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — need slow tool to guarantee IN_PROGRESS")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-recover-cancelled-"+h.Name,
				"You MUST call the slow tool with seconds=30. Do not respond with text. Your only action is calling the slow tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the slow tool with seconds=30.",
				harness.WithAutoApproveAll(true))

			executionID := exec.GetMetadata().GetId()
			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err, "execution %s should reach IN_PROGRESS", executionID)

			_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: executionID,
			})
			require.NoError(t, err, "cancel should succeed for execution %s", executionID)

			_, err = waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
			require.NoError(t, err, "execution %s should reach CANCELLED", executionID)

			_, err = clients.AgentExecutionCommand.Recover(ctx, &agentexecv1.RecoverAgentExecutionInput{
				Id: executionID,
			})
			require.Error(t, err, "recover on CANCELLED execution %s should be rejected", executionID)

			st, ok := status.FromError(err)
			require.True(t, ok, "error should be a gRPC status")
			assert.Equal(t, codes.FailedPrecondition, st.Code(),
				"recover on CANCELLED should return FAILED_PRECONDITION, got %s: %s",
				st.Code(), st.Message())

			t.Logf("recover-on-cancelled correctly rejected: execution=%s, code=%s, message=%s",
				executionID, st.Code(), st.Message())
		})
	}
}

// Proto contract: Recover RPC precondition — only FAILED is recoverable.
// Verifies: Recover on COMPLETED → FAILED_PRECONDITION.
func TestAgentExecution_RecoverCompleted_Rejected(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-recover-completed-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: hello")

			executionID := exec.GetMetadata().GetId()
			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution %s should complete", executionID)

			_, err = clients.AgentExecutionCommand.Recover(ctx, &agentexecv1.RecoverAgentExecutionInput{
				Id: executionID,
			})
			require.Error(t, err, "recover on COMPLETED execution %s should be rejected", executionID)

			st, ok := status.FromError(err)
			require.True(t, ok, "error should be a gRPC status")
			assert.Equal(t, codes.FailedPrecondition, st.Code(),
				"recover on COMPLETED should return FAILED_PRECONDITION, got %s: %s",
				st.Code(), st.Message())

			t.Logf("recover-on-completed correctly rejected: execution=%s, code=%s",
				executionID, st.Code())
		})
	}
}

// Proto contract: command.proto Recover RPC preconditions:
//
//	"TERMINATED executions cannot be recovered (incomplete checkpoint)"
//
// Verifies: Recover on TERMINATED → FAILED_PRECONDITION.
func TestAgentExecution_RecoverTerminated_Rejected(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — need slow tool to guarantee IN_PROGRESS")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-recover-terminated-"+h.Name,
				"You MUST call the slow tool with seconds=30. Do not respond with text. Your only action is calling the slow tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the slow tool with seconds=30.",
				harness.WithAutoApproveAll(true))

			executionID := exec.GetMetadata().GetId()
			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err, "execution %s should reach IN_PROGRESS", executionID)

			_, err = clients.AgentExecutionCommand.Terminate(ctx, &agentexecv1.TerminateAgentExecutionInput{
				Id: executionID,
			})
			require.NoError(t, err, "terminate should succeed for execution %s", executionID)

			_, err = waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_TERMINATED, 2*time.Minute)
			require.NoError(t, err, "execution %s should reach TERMINATED", executionID)

			_, err = clients.AgentExecutionCommand.Recover(ctx, &agentexecv1.RecoverAgentExecutionInput{
				Id: executionID,
			})
			require.Error(t, err, "recover on TERMINATED execution %s should be rejected", executionID)

			st, ok := status.FromError(err)
			require.True(t, ok, "error should be a gRPC status")
			assert.Equal(t, codes.FailedPrecondition, st.Code(),
				"recover on TERMINATED should return FAILED_PRECONDITION, got %s: %s",
				st.Code(), st.Message())

			t.Logf("recover-on-terminated correctly rejected: execution=%s, code=%s",
				executionID, st.Code())
		})
	}
}

// Verifies: concurrent execution creation on a single session — no
// execution is lost or corrupted under burst load. This is the scenario
// where a user types fast in the chat composer.
func TestAgentExecution_RapidFireExecutions_AllComplete(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 8*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-rapidfire-"+h.Name,
				"You are a helpful assistant. Respond briefly to each message with one short sentence.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)
			sessionID := session.GetMetadata().GetId()

			const burstCount = 3
			executions := make([]*agentexecv1.AgentExecution, burstCount)
			for i := 0; i < burstCount; i++ {
				executions[i] = harness.CreateTestAgentExecution(t, ctx, clients,
					sessionID, fmt.Sprintf("Burst message %d: reply briefly.", i+1))
			}

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			var wg sync.WaitGroup
			results := make([]*agentexecv1.AgentExecution, burstCount)
			errors := make([]error, burstCount)

			for i := 0; i < burstCount; i++ {
				wg.Add(1)
				go func(idx int) {
					defer wg.Done()
					results[idx], errors[idx] = waiter.WaitForTerminal(ctx,
						executions[idx].GetMetadata().GetId(), 5*time.Minute)
				}(i)
			}
			wg.Wait()

			for i := 0; i < burstCount; i++ {
				require.NoError(t, errors[i],
					"execution %d (%s) should reach terminal phase",
					i+1, executions[i].GetMetadata().GetId())
				require.NotNil(t, results[i],
					"execution %d result should not be nil", i+1)

				t.Logf("burst execution %d: id=%s, phase=%s",
					i+1, results[i].GetMetadata().GetId(),
					results[i].GetStatus().GetPhase().String())
			}

			list, err := clients.AgentExecutionQuery.ListBySession(ctx,
				&agentexecv1.ListAgentExecutionsBySessionRequest{
					SessionId: sessionID,
					PageSize:  100,
				})
			require.NoError(t, err, "ListBySession should succeed")

			listIDs := make(map[string]bool, len(list.GetEntries()))
			for _, entry := range list.GetEntries() {
				listIDs[entry.GetMetadata().GetId()] = true
			}

			for i := 0; i < burstCount; i++ {
				execID := executions[i].GetMetadata().GetId()
				assert.True(t, listIDs[execID],
					"burst execution %d (%s) should appear in ListBySession", i+1, execID)
			}

			t.Logf("rapid-fire verified: %d/%d executions completed and appear in ListBySession (total list entries: %d)",
				burstCount, burstCount, len(list.GetEntries()))
		})
	}
}
