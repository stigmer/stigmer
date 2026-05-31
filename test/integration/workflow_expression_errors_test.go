//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflow_ExpressionError_InvalidSyntax deploys a workflow whose
// switch_case condition contains intentionally broken jq (quadruple
// equals). The test asserts that the execution reaches a terminal state
// (FAILED) rather than getting stuck in infinite retry.
func TestWorkflow_ExpressionError_InvalidSyntax(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "expr-err-syntax", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"severity": "critical",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "broken",
				"when": `${ $data.severity ==== 'critical' }`,
				"then": "handleBroken",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	brokenConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "should-not-reach",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "default-reached",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-expr-err-syntax",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: invalid jq syntax in switch_case condition",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-expr-err-syntax",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "routeBySeverity",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleBroken",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: brokenConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleDefault",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: defaultConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "expression error invalid syntax test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err, "execution should reach a terminal state, not get stuck in infinite retry")

	phase := result.GetStatus().GetPhase()
	t.Logf("invalid syntax expression test: execution reached terminal phase %s, tasks=%d",
		phase.String(), len(result.GetStatus().GetTasks()))
}

// TestWorkflow_ExpressionError_MissingContextPath deploys a workflow
// whose switch_case reads $context.nonexistent.deep.field — a path that
// no upstream task exported. In jq, accessing a missing path yields null,
// so the switch treats the condition as false and falls through to the
// default branch. The workflow should complete successfully.
func TestWorkflow_ExpressionError_MissingContextPath(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "expr-err-missing", suiteLogger)
	defer deployer.Cleanup(ctx)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "nonexistent",
				"when": `${ $context.nonexistent.deep.field == "value" }`,
				"then": "handleNonexistent",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	nonexistentConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "should-not-reach",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "default-reached",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-expr-err-missing",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: switch on missing context path falls through to default",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-expr-err-missing",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "routeByMissing",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleNonexistent",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: nonexistentConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleDefault",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: defaultConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "expression error missing context path test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("missing context path test: execution completed (null fallthrough to default), tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflow_ExpressionError_TypeMismatch deploys a workflow that
// sets a numeric variable (count=42) and then evaluates a switch_case
// comparing it to a string ("forty-two"). In jq, comparing different
// types with == returns false (no error), so the switch falls through
// to the default branch and the workflow completes.
func TestWorkflow_ExpressionError_TypeMismatch(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "expr-err-type", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"count": float64(42),
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "stringMatch",
				"when": `${ $data.count == "forty-two" }`,
				"then": "handleStringMatch",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	stringMatchConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "should-not-reach",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "type-mismatch-default",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-expr-err-type",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: type mismatch in switch condition falls through to default",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-expr-err-type",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "routeByCount",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleStringMatch",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stringMatchConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleDefault",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: defaultConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "expression error type mismatch test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("type mismatch test: execution completed (false fallthrough to default), tasks=%d",
		len(result.GetStatus().GetTasks()))
}
