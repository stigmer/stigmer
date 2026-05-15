//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowControlFlow_SwitchCase verifies conditional branching.
//
// Workflow structure:
//
//	initVars (set_vars) → routeBySeverity (switch_case)
//	  ├─ severity == "critical" → handleCritical (set_vars, then: end)
//	  └─ default              → handleDefault  (set_vars, then: end)
//
// The test sets severity to "critical" and asserts that handleCritical
// executes while handleDefault is skipped.
func TestWorkflowControlFlow_SwitchCase(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "switch-case", suiteLogger)
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
				"name": "critical",
				"when": "${ $data.severity == \"critical\" }",
				"then": "handleCritical",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	criticalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "escalated",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "logged",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-switch-case",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: switch_case conditional branching",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-switch-case",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeBySeverity",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleCritical",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: criticalConfig,
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "switch case test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initVars",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeBySeverity",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleCritical",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("switch_case completed: correct branch executed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}
