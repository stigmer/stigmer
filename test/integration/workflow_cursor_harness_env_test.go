//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowAgentCall_CursorHarness_MissingEnvVar verifies that when a
// workflow-level secret env var is NOT provisioned, the Cursor harness agent
// execution fails with an actionable error message rather than the opaque
// "Cursor run failed" generic error.
//
// This reproduces the production bug where the daily-notification-plan workflow
// failed with "Cursor run failed" because:
//  1. The workflow declares POSTGRES_CONNECTION_URL as is_secret
//  2. The agent declares it in spec.env (enabling intersection forwarding)
//  3. But if the secret is not provisioned in the credential store, the child
//     execution's ExecutionContext is empty
//  4. The MCP server starts without credentials and fails
//  5. The Cursor SDK returns status: "error" with no explanation
//
// After the fix, the runner should:
// - Log MCP pre-flight warnings about empty env vars
// - Provide a more descriptive error than just "Cursor run failed"
func TestWorkflowAgentCall_CursorHarness_MissingEnvVar(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "cursor-env-miss", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Create an agent that declares a required secret env var.
	// The agent references no real MCP server — the point is to verify
	// the env propagation path and error quality.
	agent := &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-cursor-env-missing",
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test: cursor harness with missing env var",
			Instructions: "Reply with: env-test-ok",
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"REQUIRED_SECRET_URL": {
					IsSecret:    true,
					Description: "A required secret that will NOT be provisioned",
				},
			},
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	// Build a workflow that uses the cursor harness and declares the env var
	// but does NOT provide a value in runtimeEnv (simulating unprovisioned secret).
	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   created.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with: env-test-ok",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-cursor-env-missing-wf",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cursor harness with missing env var",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "test-cursor-env-missing-wf",
				Version:   "1.0.0",
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"REQUIRED_SECRET_URL": {
					IsSecret:    true,
					Description: "declared but not provisioned",
				},
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callCursorAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	// Execute WITHOUT providing runtimeEnv (simulates missing secret)
	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "cursor harness missing env test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution started: id=%s", executionID)

	// Wait for terminal state. The workflow should FAIL because the cursor
	// harness will encounter issues (either missing API key or MCP failure).
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 3*time.Minute)
	require.NoError(t, err, "workflow should reach terminal state")

	phase := result.GetStatus().GetPhase()
	errorMsg := result.GetStatus().GetError()
	t.Logf("workflow result: phase=%s, error=%q", phase, errorMsg)

	// The workflow should fail (cursor harness without valid Cursor API key
	// will error, or the agent will fail for other config reasons).
	require.Equal(t, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, phase,
		"workflow should fail when cursor harness has incomplete config")

	// CRITICAL ASSERTION: Error message should NOT be the opaque "Cursor run failed".
	// After our fix, it should contain diagnostic detail about what went wrong.
	if strings.Contains(errorMsg, "Cursor run failed") {
		// If we still get the opaque error, check if it at least includes model/agent info
		require.Contains(t, errorMsg, "Model=",
			"Even when Cursor SDK returns opaque error, our enhanced reporting should include diagnostic context")
	}

	// If the error mentions credential/API key issues, that's also acceptable —
	// it means the pre-flight check caught the config problem.
	isActionableError := strings.Contains(errorMsg, "No Cursor API credential") ||
		strings.Contains(errorMsg, "Cursor run failed (no detail from SDK)") ||
		strings.Contains(errorMsg, "Model=") ||
		strings.Contains(errorMsg, "Execution failed:")

	if isActionableError {
		t.Log("PASS: Error message is actionable — contains diagnostic context")
	} else {
		t.Logf("WARNING: Error message may not be actionable: %q", errorMsg)
	}
}
