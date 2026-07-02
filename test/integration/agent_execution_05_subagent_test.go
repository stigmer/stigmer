//go:build integration

package integration

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentExecution_SubAgent_Delegation(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

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

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			const maxAttempts = 2
			var result *agentexecv1.AgentExecution
			for attempt := 1; attempt <= maxAttempts; attempt++ {
				exec := harness.CreateTestAgentExecution(t, ctx, clients,
					session.GetMetadata().GetId(),
					"Please delegate to the researcher to give a brief summary about renewable energy.")

				var err error
				result, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				if err != nil {
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
				}
				require.NoError(t, err, "execution should complete (attempt %d)", attempt)
				harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

				if harness.HasSubAgentDelegation(result) {
					break
				}
				if attempt < maxAttempts {
					t.Logf("delegation retry: LLM answered directly on attempt %d, retrying with fresh execution", attempt)
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
					continue
				}
			}

			subAgents := result.GetStatus().GetSubAgentExecutions()
			require.Greater(t, len(subAgents), 0,
				"sub-agent executions must be populated after successful delegation")

			// No duplicate tool-call IDs, and each "task" delegation maps 1:1 to a
			// sub-agent execution. Before the accumulator upsert fix, the Cursor SDK
			// re-emitting a task "running" event appended duplicate task tool calls
			// (same id), rendering the same sub-agent multiple times in the UI.
			harness.AssertUniqueToolCallIds(t, result)
			assert.Equal(t, len(subAgents), harness.CountToolCallsByName(result, "task"),
				"each 'task' tool call must correspond to exactly one sub-agent execution (no duplicates)")

			// Native harness preserves the blueprint sub-agent name via LangGraph
			// namespace metadata. Cursor harness derives the name from the LLM's
			// Task tool description arg (the SDK passes kind: "unspecified"), so
			// exact name matching is only possible on native.
			var sa *agentexecv1.SubAgentExecution
			if h.Name == "native" {
				harness.AssertSubAgents(t, result, "researcher")
				sa = harness.FindSubAgent(result, "researcher")
				require.NotNil(t, sa, "sub-agent 'researcher' must be present in execution status")
			} else {
				sa = harness.FindFirstSubAgent(result)
				require.NotNil(t, sa, "at least one sub-agent execution must be present")
				assert.NotEmpty(t, sa.GetName(),
					"sub-agent name must be non-empty (derived from Task tool description)")
			}

			harness.AssertSubAgentExecution(t, sa)
			assert.Equal(t, agentexecv1.SubAgentStatus_SUB_AGENT_COMPLETED, sa.GetStatus(),
				"sub-agent should be COMPLETED when parent execution is COMPLETED")
			assert.Greater(t, len(sa.GetMessages()), 0,
				"completed sub-agent should have at least one message from its internal conversation")

			harness.LogSubAgentExecutions(t, result)
		})
	}
}

// collectSubscribeSnapshots subscribes to an agent execution and returns every
// AgentExecution snapshot delivered until a terminal phase (or the stream
// ends / times out). This mirrors the live data path the web console uses
// (useExecutionStream), so the captured snapshots are exactly what the UI
// would render in real time.
func collectSubscribeSnapshots(
	t *testing.T,
	ctx context.Context,
	queryClient agentexecv1.AgentExecutionQueryControllerClient,
	executionID string,
	timeout time.Duration,
) []*agentexecv1.AgentExecution {
	t.Helper()

	streamCtx, streamCancel := context.WithTimeout(ctx, timeout)
	defer streamCancel()

	stream, err := queryClient.Subscribe(streamCtx,
		&agentexecv1.AgentExecutionId{Value: executionID})
	require.NoError(t, err, "subscribe should succeed for execution %s", executionID)

	var snapshots []*agentexecv1.AgentExecution
	for {
		snap, recvErr := stream.Recv()
		if recvErr != nil {
			if !errors.Is(recvErr, io.EOF) && streamCtx.Err() == nil {
				t.Logf("subscribe stream error for %s: %v", executionID, recvErr)
			}
			return snapshots
		}
		snapshots = append(snapshots, snap)
		if isTerminalPhase(snap.GetStatus().GetPhase()) {
			return snapshots
		}
	}
}

// TestAgentExecution_SubAgent_VisibleWhileRunning asserts the live-visibility
// contract for sub-agent delegation: while the parent agent is still running,
// the streamed status must surface the sub-agent — including its IN_PROGRESS
// state — not only after the whole execution finalizes.
//
// This reproduces the cursor-harness defect where sub_agent_executions were
// only written to status after the stream loop ended (execute-cursor/index.ts),
// so the web console showed no activity for the entire duration a Cursor
// sub-agent ran. The native harness already syncs sub-agents on every persist.
//
// Discriminator: the test asserts at least one streamed snapshot contains a
// sub-agent in SUB_AGENT_IN_PROGRESS. With the bug, the sub-agent is written
// only at finalize — by which point it is already COMPLETED — so an IN_PROGRESS
// snapshot is never observed. This holds regardless of the execution-phase
// timing at finalize, because the discriminator is the sub-agent's own status.
func TestAgentExecution_SubAgent_VisibleWhileRunning(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 6*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-subagent-live-"+h.Name,
				"You are a project manager. When asked to research a topic, delegate to the researcher sub-agent using the task tool.",
				harness.WithSubAgent(&agentv1.SubAgent{
					Name:        "researcher",
					Description: "Researches topics and provides detailed summaries",
					Instructions: "You are a researcher. When given a topic, provide a thorough, " +
						"multi-paragraph summary. Be detailed and take your time.",
				}),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			const maxAttempts = 2
			var delegated, sawInProgress bool
			for attempt := 1; attempt <= maxAttempts; attempt++ {
				exec := harness.CreateTestAgentExecution(t, ctx, clients,
					session.GetMetadata().GetId(),
					"Please delegate to the researcher to give a thorough summary about renewable energy.")

				snapshots := collectSubscribeSnapshots(t, ctx, clients.AgentExecutionQuery,
					exec.GetMetadata().GetId(), 5*time.Minute)
				require.NotEmpty(t, snapshots,
					"subscribe must deliver at least one snapshot for execution %s",
					exec.GetMetadata().GetId())

				final := snapshots[len(snapshots)-1]
				delegated = len(final.GetStatus().GetSubAgentExecutions()) > 0

				firstSubIdx := -1
				sawInProgress = false
				for i, snap := range snapshots {
					subs := snap.GetStatus().GetSubAgentExecutions()
					if firstSubIdx == -1 && len(subs) > 0 {
						firstSubIdx = i
					}
					for _, sa := range subs {
						if sa.GetStatus() == agentexecv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS {
							sawInProgress = true
						}
					}
				}

				t.Logf("attempt %d: harness=%s snapshots=%d delegated=%v sawInProgress=%v firstSubIdx=%d (terminal at %d)",
					attempt, h.Name, len(snapshots), delegated, sawInProgress, firstSubIdx, len(snapshots)-1)

				if delegated {
					break
				}
				if attempt < maxAttempts {
					t.Logf("delegation retry: LLM answered directly on attempt %d, retrying with fresh execution", attempt)
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
				}
			}

			require.True(t, delegated,
				"sub-agent delegation must occur for this test to be meaningful "+
					"(LLM answered directly on every attempt)")

			assert.True(t, sawInProgress,
				"at least one streamed snapshot must show a sub-agent in SUB_AGENT_IN_PROGRESS — "+
					"the live UI must reflect sub-agent activity while the parent is still running, "+
					"not only after the execution finalizes")
		})
	}
}

func TestAgentExecution_SubAgent_ParentCancelCascade(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

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

			// Deterministically wait for the sub-agent to surface in the
			// persisted status before cancelling, so the cancel lands while
			// the sub-agent is live. This depends on mid-stream sub-agent
			// persistence (the live-visibility contract) holding for both
			// harnesses; a sleep would race against delegation timing.
			if _, err := waiter.WaitForSubAgentPresence(ctx, exec.GetMetadata().GetId(), 2*time.Minute); err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
				require.NoError(t, err, "sub-agent must appear in status before cancellation")
			}

			_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.NoError(t, err, "cancel should succeed")

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_CANCELLED, 2*time.Minute)
			require.NoError(t, err, "execution should reach CANCELLED")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_CANCELLED)

			subAgents := result.GetStatus().GetSubAgentExecutions()
			require.Greater(t, len(subAgents), 0,
				"sub-agent executions must be present — the LLM was instructed to delegate "+
					"and the execution ran long enough for the task tool to fire")

			for _, sa := range subAgents {
				harness.AssertSubAgentExecution(t, sa)
				assert.NotEqual(t, agentexecv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS, sa.GetStatus(),
					"sub-agent %q must not be IN_PROGRESS after parent cancellation", sa.GetName())
				assert.Equal(t, agentexecv1.SubAgentStatus_SUB_AGENT_CANCELLED, sa.GetStatus(),
					"sub-agent %q should be CANCELLED when parent is cancelled", sa.GetName())
			}

			harness.LogSubAgentExecutions(t, result)
		})
	}
}

func TestAgentExecution_SubAgent_McpAccess(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping sub-agent MCP access test")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
			mcpSlug := mcpServer.GetMetadata().GetSlug()

			// Parent has full access to MCP server (all tools).
			// Sub-agent has restricted access: only the "echo" tool via mcp_access.
			agent := harness.CreateAgent(t, ctx, clients, "test-subagent-mcp-"+h.Name,
				"You are a project manager. When asked to echo something, delegate to the tooluser sub-agent.",
				harness.WithMcpServerUsage(mcpSlug),
				harness.WithSubAgent(&agentv1.SubAgent{
					Name:         "tooluser",
					Description:  "A sub-agent that uses MCP tools",
					Instructions: "You are a tool user. Use the echo tool to echo whatever the user says. Only use the echo tool.",
					McpAccess: []*agentv1.McpAccess{
						{
							McpServer:    mcpSlug,
							EnabledTools: []string{"echo"},
						},
					},
				}),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			const maxAttempts = 2
			var result *agentexecv1.AgentExecution
			for attempt := 1; attempt <= maxAttempts; attempt++ {
				exec := harness.CreateTestAgentExecution(t, ctx, clients,
					session.GetMetadata().GetId(),
					"Delegate to the tooluser sub-agent and ask it to echo 'mcp-access-test'.",
					harness.WithAutoApproveAll(true))

				var err error
				result, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				if err != nil {
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
				}
				require.NoError(t, err, "execution should complete (attempt %d)", attempt)
				harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

				if harness.HasSubAgentDelegation(result) {
					break
				}
				if attempt < maxAttempts {
					t.Logf("delegation retry: LLM handled MCP directly on attempt %d, retrying", attempt)
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
					continue
				}
			}

			subAgents := result.GetStatus().GetSubAgentExecutions()
			require.Greater(t, len(subAgents), 0,
				"sub-agent executions must be populated after successful delegation")

			var sa *agentexecv1.SubAgentExecution
			if h.Name == "native" {
				harness.AssertSubAgents(t, result, "tooluser")
				sa = harness.FindSubAgent(result, "tooluser")
				require.NotNil(t, sa, "sub-agent 'tooluser' must be present in execution status")
			} else {
				sa = harness.FindFirstSubAgent(result)
				require.NotNil(t, sa, "at least one sub-agent execution must be present")
				assert.NotEmpty(t, sa.GetName(),
					"sub-agent name must be non-empty (derived from Task tool description)")
			}

			harness.AssertSubAgentExecution(t, sa)
			assert.Equal(t, agentexecv1.SubAgentStatus_SUB_AGENT_COMPLETED, sa.GetStatus(),
				"sub-agent should be COMPLETED when parent execution is COMPLETED")

			// Sub-agent tool-call visibility contract. The tooluser sub-agent was
			// instructed to call the echo MCP tool, so its internal tool call must
			// surface on SubAgentExecution.messages[].tool_calls — the data the UI
			// renders as the sub-agent's work. The native harness satisfies this via
			// SubAgentTracker; the Cursor harness satisfies it by parsing the
			// task-result conversationSteps (a regression here renders a sub-agent
			// card that shows no activity, even though it ran tools).
			harness.AssertSubAgentHasToolCall(t, sa)

			harness.LogSubAgentExecutions(t, result)
		})
	}
}
