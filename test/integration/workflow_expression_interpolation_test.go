//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowExpressionInterpolation_EmbeddedEnvInAgentMessage verifies
// that embedded `${ $env.KEY }` expressions within an agent_call message
// string are resolved at runtime by the workflow engine's expression
// interpolation pipeline.
//
// This tests the CNCF Serverless Workflow 1.0.0 spec-documented capability
// of embedded expressions in multi-line strings (see the official spec
// reference page examples). Prior to the interpolation fix, these expressions
// passed through as raw `${ ... }` text to the child agent.
//
// The test verifies two cases:
//  1. Provided env var: `${ $env.TEST_VALUE }` resolves to the supplied value
//  2. Missing optional env var: `${ $env.OPTIONAL_VAR }` resolves to empty string
func TestWorkflowExpressionInterpolation_EmbeddedEnvInAgentMessage(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "expr-interp", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createInterpolationTestAgent(t, ctx, clients)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Value is ${ $env.TEST_VALUE } and optional is ${ $env.OPTIONAL_VAR } — end",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-expr-interpolation",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: embedded expression interpolation in agent_call message",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-expr-interpolation",
				Version:   "1.0.0",
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"TEST_VALUE": {
					Description: "Test value that should be interpolated into the agent message",
				},
				"OPTIONAL_VAR": {
					Description: "Optional var — not provided, should resolve to empty string",
					Optional:    true,
				},
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callInterpolationAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	runtimeEnv := map[string]*executionctxv1.ExecutionValue{
		"TEST_VALUE": {Value: "hello-world"},
	}

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, workflow, "expression interpolation test", runtimeEnv)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	// Wait for the CallAgent activity to create the child AgentExecution.
	time.Sleep(20 * time.Second)

	childExec := findChildAgentExecutionByPrefix(t, ctx, clients, "expr-interp")
	require.NotNil(t, childExec,
		"CallAgent activity should have created a child AgentExecution")

	childMessage := childExec.GetSpec().GetMessage()
	t.Logf("child agent execution message: %q", childMessage)

	assert.Contains(t, childMessage, "Value is hello-world",
		"embedded ${ $env.TEST_VALUE } should be interpolated to 'hello-world'")
	assert.Contains(t, childMessage, "and optional is  —",
		"missing optional ${ $env.OPTIONAL_VAR } should resolve to empty string")
	assert.NotContains(t, childMessage, "${ $env.",
		"no raw expression placeholders should remain in the message")

	t.Logf("PASS: embedded expressions correctly interpolated in agent_call message")
}

func createInterpolationTestAgent(t *testing.T, ctx context.Context, clients *harness.Clients) *agentv1.Agent {
	t.Helper()

	agent := &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-expr-interpolation-agent",
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test agent for expression interpolation verification",
			Instructions: "You are a test agent. Reply with exactly what is asked.",
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	return created
}

func findChildAgentExecutionByPrefix(t *testing.T, ctx context.Context, clients *harness.Clients, prefix string) *agentexecv1.AgentExecution {
	t.Helper()

	resp, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
	require.NoError(t, err, "listing agent executions should succeed")

	for _, ae := range resp.GetEntries() {
		if ae.GetSpec().GetParentWorkflowId() != "" &&
			strings.Contains(ae.GetMetadata().GetSlug(), prefix) {
			return ae
		}
	}

	for _, ae := range resp.GetEntries() {
		if ae.GetSpec().GetParentWorkflowId() != "" {
			return ae
		}
	}

	return nil
}
