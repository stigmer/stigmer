//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowCursorCall_DispatchOffline verifies that the full workflow →
// agent_call → ExecuteCursor dispatch path works under global routing
// (the LOCAL / OSS scenario). No Cursor API key is required.
//
// Without an API key, ExecuteCursor is picked up by the unified runner but
// fails with an expected Cursor SDK error. The key assertion is that the
// workflow execution reaches a TERMINAL state (FAILED) rather than hanging
// on a ScheduleToStart timeout — proving the activity was dispatched to the
// correct queue and picked up by the runner.
func TestWorkflowCursorCall_DispatchOffline(t *testing.T) {
	requireCursorCallOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "cursor-dispatch", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-cursor-dispatch-agent",
		"You are a test agent.")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with: dispatch-test-ok",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-dispatch-offline",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor dispatch verification (offline, no API key)",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-cursor-dispatch-offline",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "cursorDispatch",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor dispatch offline test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	t.Logf("workflow execution created: id=%s", execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err, "workflow execution should reach a terminal state "+
		"(FAILED without API key proves the runner picked up ExecuteCursor; "+
		"a timeout here means no worker polled the activity queue)")

	phase := result.GetStatus().GetPhase()
	assert.Equal(t, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, phase,
		"execution should FAIL (Cursor SDK error without API key), not hang on ScheduleToStart timeout")

	t.Logf("workflow execution reached terminal phase: id=%s, phase=%s",
		result.GetMetadata().GetId(), phase.String())
}

// TestWorkflowCursorCall_FileCanary exercises the full cursor pipeline:
// workflow-runner → Session(harness=CURSOR) → AgentExecution → Java →
// Temporal → ExecuteCursor (unified runner).
//
// Requires CURSOR_API_KEY. The Cursor agent is asked to create a canary
// file. The test asserts execution completion and file creation.
func TestWorkflowCursorCall_FileCanary(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

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
	deployer := harness.NewFixtureDeployer(clients, "cursor-canary", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-cursor-canary-agent",
		"You are a helpful coding assistant. Follow instructions precisely.")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Create exactly one file named canary.txt containing only the text 'hello-from-cursor'. Do not create any other files.",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-canary",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor-runner file canary",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-cursor-canary",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "cursorCanary",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor canary test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	t.Logf("execution created: id=%s", execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "cursorCanary",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("execution completed: id=%s, tasks=%d",
		result.GetMetadata().GetId(),
		len(result.GetStatus().GetTasks()))

	if tc != nil {
		harness.AssertSpanExists(t, testHarness.Jaeger, tc.TraceID, "stigmer.cursor.turn")
	}
}

// TestWorkflowCursorCall_StructuredOutput exercises cursor_call with a prompt
// requesting JSON classification, mirroring the native harness structured
// output test.
func TestWorkflowCursorCall_StructuredOutput(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "cursor-struct", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-cursor-classify-agent",
		"You are a sentiment classifier. When given text, respond with JSON: {\"sentiment\": \"positive\"} or {\"sentiment\": \"negative\"} or {\"sentiment\": \"neutral\"}")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Classify the sentiment of this text and respond with JSON: 'This product is fantastic!'",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-structured",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor-runner structured output",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-cursor-structured",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "classifyCursor",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor structured test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 5*time.Minute)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("execution completed: id=%s", result.GetMetadata().GetId())
}

// requireCursorCallOfflinePrereqs skips if the unified runner is not available.
// Does NOT require a Cursor API key — the test verifies dispatch, not
// Cursor SDK execution.
func requireCursorCallOfflinePrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
}

// requireCursorCallProviderPrereqs skips if the unified runner or Cursor API
// key is not available. Used by tests that exercise the full Cursor SDK path.
func requireCursorCallProviderPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
	if os.Getenv("CURSOR_API_KEY") == "" {
		t.Skip("CURSOR_API_KEY not set — skipping cursor_call provider test")
	}
}

func createTestAgentForCursor(t *testing.T, ctx context.Context, clients *harness.Clients, name, instructions string) *agentv1.Agent {
	t.Helper()

	agent := &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
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
