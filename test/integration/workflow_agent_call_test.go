//go:build integration

package integration

import (
	"context"
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

// TestWorkflowAgentCall_SimpleExecution exercises the full agent_call pipeline:
// workflow-runner → Java service → Python agent-runner (LangGraph).
// Skipped when the agent-runner is not available (no API key or venv).
func TestWorkflowAgentCall_SimpleExecution(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var tc *harness.TraceContext
	if testHarness.OTelEnabled() {
		tc = harness.StartTestTrace(ctx, t, testHarness.Jaeger)
		tc.RegisterCleanup(t, testHarness.OutputDir())
		ctx = tc.Context()
	}

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "agent-simple", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgent(t, ctx, clients, "test-simple-agent",
		"You are a helpful assistant. When asked, respond briefly and directly.")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Reply with exactly: hello-from-agent",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-agent-simple",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call simple execution",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-agent-simple",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "agent simple test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	t.Logf("execution created: id=%s", execution.GetMetadata().GetId())

	// agent_call is async (callback token pattern) so allow more time
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "callAgent",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("execution completed: id=%s, tasks=%d",
		result.GetMetadata().GetId(),
		len(result.GetStatus().GetTasks()))

	if tc != nil {
		harness.AssertSpanExists(t, testHarness.Jaeger, tc.TraceID, "stigmer.llm.call")
	}
}

// TestWorkflowAgentCall_StructuredOutput exercises agent_call with a message
// requesting JSON classification. The agent's LLM response is expected to
// contain structured data.
func TestWorkflowAgentCall_StructuredOutput(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "agent-struct", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgent(t, ctx, clients, "test-classify-agent",
		"You are a sentiment classifier. When given text, respond with JSON: {\"sentiment\": \"positive\"} or {\"sentiment\": \"negative\"} or {\"sentiment\": \"neutral\"}")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Classify the sentiment of this text and respond with JSON: 'This product is fantastic!'",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-agent-structured",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call structured output",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-agent-structured",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "classifyAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "agent structured test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("execution completed: id=%s", result.GetMetadata().GetId())
}

func requireAgentCallPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — skipping agent_call test")
	}
}

// TestWorkflowAgentCall_NonexistentAgent verifies that a workflow with
// a call:agent task referencing a nonexistent agent fails with a clear
// error rather than hanging or producing an opaque failure.
func TestWorkflowAgentCall_NonexistentAgent(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "agent-notfound", suiteLogger)
	defer deployer.Cleanup(ctx)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   "nonexistent-agent-slug-xyz",
		"org":     "test-org",
		"message": "This should fail because the agent does not exist",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-agent-notfound",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call with nonexistent agent",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-agent-notfound",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callMissingAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "agent not found test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 90*time.Second)
	require.NoError(t, err, "execution should reach FAILED phase for nonexistent agent")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)

	t.Logf("execution correctly failed for nonexistent agent: id=%s", result.GetMetadata().GetId())
}

// TestWorkflowAgentCall_ChildFailurePropagates verifies that when a child agent
// execution fails (ExecuteDeepAgent returns EXECUTION_FAILED phase), the parent
// workflow correctly propagates the failure instead of reporting success.
//
// This test exercises the fix for the error propagation bug where
// ExecuteDeepAgent returns a status with EXECUTION_FAILED (rather than
// throwing), and the Go orchestrator previously treated it as a successful
// activity return, completing the parent callback with success.
func TestWorkflowAgentCall_ChildFailurePropagates(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "agent-fail-prop", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Create an agent with a nonexistent MCP server reference.
	// The agent execution will start but fail because the MCP server
	// cannot be resolved at runtime, and the agent requires it to function.
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-fail-propagation-agent",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test agent: failure propagation",
			Instructions: "You must use the nonexistent-mcp-tool to answer. If you cannot use it, report failure.",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "nonexistent-mcp-server-xyz",
						Org:  "test-org",
					},
				},
			},
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed even with invalid MCP ref")
	require.NotEmpty(t, created.GetMetadata().GetId())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   created.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Use the nonexistent-mcp-tool to process this request",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-child-failure-propagation",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: child agent_call failure propagates to parent workflow",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-child-failure-propagation",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "child failure propagation test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	t.Logf("execution created: id=%s", execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 2*time.Minute)
	require.NoError(t, err, "execution should reach FAILED phase when child agent execution fails")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	harness.AssertTaskStatus(t, result, "callFailingAgent",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED)

	t.Logf("execution correctly failed with child failure propagation: id=%s, phase=%s",
		result.GetMetadata().GetId(),
		result.GetStatus().GetPhase().String())
}

func createTestAgent(t *testing.T, ctx context.Context, clients *harness.Clients, name, instructions string) *agentv1.Agent {
	t.Helper()

	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test agent: " + name,
			Instructions: instructions,
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent %q should succeed", name)
	require.NotEmpty(t, created.GetMetadata().GetId(), "agent should have an ID")

	t.Logf("created agent: name=%s, id=%s, slug=%s",
		created.GetMetadata().GetName(),
		created.GetMetadata().GetId(),
		created.GetMetadata().GetSlug())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up agent %s: %v", name, err)
		}
	})

	return created
}
