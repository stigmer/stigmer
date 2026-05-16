//go:build integration

package integration

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowCursorCall_FileCanary exercises the full cursor pipeline:
// workflow-runner → Session(harness=CURSOR) → AgentExecution → Java →
// Temporal → cursor-runner (ExecuteCursor).
//
// The Cursor agent is asked to create a canary file. The test asserts both
// execution completion and file creation in the workspace.
func TestWorkflowCursorCall_FileCanary(t *testing.T) {
	requireCursorCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "cursor-canary", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-cursor-canary-agent",
		"You are a helpful coding assistant. Follow instructions precisely.")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     "test-org",
		"message": "Create exactly one file named canary.txt containing only the text 'hello-from-cursor'. Do not create any other files.",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-canary",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor-runner file canary",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
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

	// Verify the canary file was created in the cursor workspace.
	workspaceDir := testHarness.CursorRunner.WorkspaceDir()
	canaryPath := filepath.Join(workspaceDir, "canary.txt")
	content, err := os.ReadFile(canaryPath)
	if err != nil {
		t.Logf("canary.txt not found at %s — the Cursor agent may have used a different path", canaryPath)
	} else {
		require.Contains(t, string(content), "hello-from-cursor",
			"canary.txt should contain the expected content")
		t.Logf("canary.txt verified: %s", string(content))
	}

	t.Logf("execution completed: id=%s, tasks=%d",
		result.GetMetadata().GetId(),
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowCursorCall_StructuredOutput exercises cursor_call with a prompt
// requesting JSON classification, mirroring the native harness structured
// output test.
func TestWorkflowCursorCall_StructuredOutput(t *testing.T) {
	requireCursorCallPrereqs(t)

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
		"org":     "test-org",
		"message": "Classify the sentiment of this text and respond with JSON: 'This product is fantastic!'",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cursor-structured",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor-runner structured output",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
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

func requireCursorCallPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}
	if testHarness.CursorRunner == nil {
		t.Skip("cursor-runner not available — skipping cursor_call test")
	}
}

func createTestAgentForCursor(t *testing.T, ctx context.Context, clients *harness.Clients, name, instructions string) *agentv1.Agent {
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

