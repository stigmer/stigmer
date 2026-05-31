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

// TestWorkflowSwitch_StringEquality_SingleQuotes verifies that switch_case
// conditions using single-quoted string comparisons route correctly.
func TestWorkflowSwitch_StringEquality_SingleQuotes(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "switch-sq", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"status": "active",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "active",
				"when": "${ $data.status == 'active' }",
				"then": "handleActive",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	activeConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "matched-active",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "fell-through",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-switch-sq",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: switch_case with single-quoted string equality",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-switch-sq",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeByStatus",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleActive",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: activeConfig,
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "switch single quotes test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initVars",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeByStatus",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleActive",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("switch single-quote string equality: correct branch executed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowSwitch_StringEquality_DoubleQuotes verifies that switch_case
// conditions using double-quoted string comparisons route correctly.
func TestWorkflowSwitch_StringEquality_DoubleQuotes(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "switch-dq", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"status": "active",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "active",
				"when": "${ $data.status == \"active\" }",
				"then": "handleActive",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	activeConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "matched-active",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "fell-through",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-switch-dq",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: switch_case with double-quoted string equality",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-switch-dq",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeByStatus",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleActive",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: activeConfig,
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "switch double quotes test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initVars",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeByStatus",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleActive",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("switch double-quote string equality: correct branch executed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowSwitch_StringEquality_CaseSensitive verifies that jq string
// comparisons in switch_case are case-sensitive: "Active" != "active".
func TestWorkflowSwitch_StringEquality_CaseSensitive(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "switch-cs", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"status": "Active",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "lowercase",
				"when": "${ $data.status == 'active' }",
				"then": "handleLowercase",
			},
			map[string]any{
				"name": "titlecase",
				"when": "${ $data.status == 'Active' }",
				"then": "handleTitlecase",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	lowercaseConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "matched-lowercase",
		},
	})
	require.NoError(t, err)

	titlecaseConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "matched-titlecase",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "fell-through",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-switch-cs",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: switch_case case-sensitive string comparison",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-switch-cs",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeByStatus",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleLowercase",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: lowercaseConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleTitlecase",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: titlecaseConfig,
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "switch case-sensitive test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initVars",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeByStatus",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleTitlecase",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("switch case-sensitive: titlecase branch matched 'Active', tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowSwitch_StringEquality_SpecialChars verifies that switch_case
// correctly handles string comparisons involving hyphens and special characters.
func TestWorkflowSwitch_StringEquality_SpecialChars(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "switch-sc", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"status": "in-progress",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "inProgress",
				"when": "${ $data.status == 'in-progress' }",
				"then": "handleInProgress",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	inProgressConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "matched-in-progress",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "fell-through",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-switch-sc",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: switch_case with special characters in strings",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-switch-sc",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeByStatus",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleInProgress",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: inProgressConfig,
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "switch special chars test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initVars",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeByStatus",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleInProgress",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("switch special-chars: 'in-progress' matched correctly, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowSwitch_FromYAML verifies the full YAML -> proto -> converter -> runner
// pipeline for switch_case with single-quoted when conditions.
func TestWorkflowSwitch_FromYAML(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "switch-yaml", suiteLogger)
	defer deployer.Cleanup(ctx)

	const yamlContent = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: integration-test-switch-yaml
  visibility: visibility_private
spec:
  description: Integration test for YAML-path switch with single quotes
  document:
    dsl: "1.0.0"
    namespace: test-org
    name: integration-test-switch-yaml
    version: "1.0.0"
  tasks:
    - name: initData
      kind: set_vars
      task_config:
        variables:
          priority: "high"
    - name: routeByPriority
      kind: switch_case
      task_config:
        cases:
          - name: highPriority
            when: "${ $data.priority == 'high' }"
            then: handleHigh
          - name: default
            then: handleDefault
    - name: handleHigh
      kind: set_vars
      task_config:
        variables:
          result: "escalated"
      export:
        as: "${ . }"
      flow:
        then: end
    - name: handleDefault
      kind: set_vars
      task_config:
        variables:
          result: "logged"
      export:
        as: "${ . }"
      flow:
        then: end
`

	workflow, err := harness.ParseWorkflowYAML(yamlContent)
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "switch from YAML test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initData",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeByPriority",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleHigh",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("switch from YAML: single-quoted condition routed correctly, tasks=%d",
		len(result.GetStatus().GetTasks()))
}
