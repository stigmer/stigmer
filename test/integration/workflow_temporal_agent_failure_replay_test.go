//go:build integration

package integration

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestAgentExecution_FailureReplayDeterminism verifies that when a child agent
// execution fails within a workflow, the InvokeAgentExecutionWorkflow (Java)
// reaches terminal state WITHOUT entering a WorkflowTaskFailed retry loop.
//
// This test reproduces the production bug where commit 4ed3240c removed the
// Workflow.getVersion("single-site-fail-external") inline gate, causing
// in-flight (and sometimes fresh) agent execution workflows to get stuck in
// an infinite NonDeterministicException loop when the failure path calls
// FailExternalActivity.
//
// The test uses TemporalInspector.AssertNoWTFLoop to detect the exact
// symptom: WorkflowTaskFailed events accumulating in the agent execution
// workflow's history, indicating a non-determinism replay failure.
func TestAgentExecution_FailureReplayDeterminism(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	inspector := newTemporalInspector(t)
	deployer := harness.NewFixtureDeployer(clients, "aex-replay-det", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Create an agent referencing a real McpServer whose stdio binary does not
	// exist. Apply passes reference validation (both editions reject dangling
	// refs at apply since stigmer-cloud#146), but the runner cannot start the
	// server at runtime — reliably triggering EXECUTION_FAILED.
	brokenMcp := harness.CreateStdioMcpServer(t, ctx, clients, "/nonexistent/replay-det-mcp-binary")
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-aex-replay-determinism-agent",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test: agent execution replay determinism",
			Instructions: "You must use the nonexistent-tool. Report failure if unavailable.",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: brokenMcp.GetMetadata().GetSlug(),
						Org:  "test-org",
					},
				},
			},
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed for an existing (but unstartable) MCP server")
	require.NotEmpty(t, created.GetMetadata().GetId())
	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	// Force the Cursor harness path -- this is critical!
	// The production bug is specific to executeCursorFlow() in the Java workflow.
	// Without a CURSOR_API_KEY, the Cursor proxy returns an immediate error,
	// producing the exact "Cursor run failed" scenario from production.
	// We do NOT skip on missing CURSOR_API_KEY -- we WANT the failure.
	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   created.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Use the nonexistent-replay-det-mcp tool to process this",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-aex-replay-determinism-wf",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent execution replay determinism",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "test-aex-replay-determinism-wf",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callFailingAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "replay determinism test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution started: id=%s", executionID)

	// Wait for the parent workflow to reach terminal (FAILED expected).
	// Allow up to 3 minutes because if the bug is present, the parent may
	// time out waiting for the stuck child.
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 3*time.Minute)
	require.NoError(t, err, "parent workflow execution should reach terminal phase")
	t.Logf("parent workflow reached terminal: phase=%s", result.GetStatus().GetPhase().String())

	// The parent should report FAILED (not COMPLETED or CANCELLED).
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)

	// --- CRITICAL ASSERTIONS: Agent Execution Temporal Health ---
	//
	// Find the child agent execution workflow(s) spawned by THIS test's
	// parent execution, from the task snapshot metadata. Discovery must stay
	// scoped to this execution: the Temporal dev server is shared across the
	// whole suite, and a broad WorkflowId-prefix list would pick up agent
	// executions from unrelated tests, failing this test on their transient
	// WorkflowTaskFailed events.
	agentWorkflowIDs := findAgentExecutionWorkflows(t, result)
	require.NotEmpty(t, agentWorkflowIDs,
		"should find at least one agent execution workflow for this test")

	for _, agentWfID := range agentWorkflowIDs {
		t.Run(fmt.Sprintf("AgentWorkflow/%s", agentWfID), func(t *testing.T) {
			// ASSERTION 1: The agent execution workflow must reach terminal state.
			// If it's stuck in a WTF loop, it will remain RUNNING indefinitely.
			inspector.AssertTemporalTerminal(t, ctx, agentWfID)

			// ASSERTION 2: No WorkflowTaskFailed events (WTF loop detection).
			// A count > 0 means the workflow experienced non-determinism replay failures.
			// The production bug shows 10+ WTF events; we allow 0 for a clean execution.
			inspector.AssertNoWTFLoop(t, ctx, agentWfID, 0)

			t.Logf("agent workflow %s: terminal, no WTF loop — determinism verified", agentWfID)
		})
	}

	// Export the agent execution workflow history for the Java replay test fixture.
	exportAgentHistories(t, ctx, inspector, agentWorkflowIDs)
}

// findAgentExecutionWorkflows discovers the agent execution workflow IDs
// spawned by the given (terminal) parent workflow execution. The source of
// truth is the task snapshot metadata: the do-executor records
// `agent_execution_id` on agent_call tasks for both success and failure
// paths (failure via AgentCallError.childExecutionId).
//
// A broad Temporal visibility query (WorkflowId STARTS_WITH the agent
// execution prefix) must NOT be used here: the dev server is shared across
// the whole integration suite, so such a query returns agent executions
// from unrelated earlier tests, and a single transient WorkflowTaskFailed
// event in any of them would fail this test.
func findAgentExecutionWorkflows(t *testing.T, result *workflowexecutionv1.WorkflowExecution) []string {
	t.Helper()

	var workflowIDs []string
	seen := map[string]bool{}
	for _, task := range result.GetStatus().GetTasks() {
		aexID := task.GetMetadata().GetFields()["agent_execution_id"].GetStringValue()
		if aexID == "" || seen[aexID] {
			continue
		}
		seen[aexID] = true
		workflowIDs = append(workflowIDs, harness.AgentOrchestratorWorkflowID(aexID))
	}

	t.Logf("found %d agent execution workflows via task snapshot metadata", len(workflowIDs))
	return workflowIDs
}

// exportAgentHistories writes the agent execution workflow histories to the
// test output directory for use as replay test fixtures.
func exportAgentHistories(t *testing.T, ctx context.Context, inspector *harness.TemporalInspector, workflowIDs []string) {
	t.Helper()

	outputDir := filepath.Join(testHarness.OutputDir(), "replay-agent-execution-histories")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Logf("could not create replay output dir: %v", err)
		return
	}

	tc, err := harness.NewTemporalClient(testHarness.Temporal.Address())
	if err != nil {
		t.Logf("could not connect to Temporal for history export: %v", err)
		return
	}
	defer tc.Close()

	exporter := harness.NewHistoryExporter(tc, outputDir)

	for i, wfID := range workflowIDs {
		filename := fmt.Sprintf("agent-execution-failure-%d.json", i)
		if err := exporter.Export(ctx, wfID, "", filename); err != nil {
			t.Logf("failed to export history for %s: %v", wfID, err)
		} else {
			t.Logf("exported agent execution history: %s/%s (workflow=%s)", outputDir, filename, wfID)
		}
	}
}
