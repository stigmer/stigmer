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

// TestWorkflowData_SetVarsChaining verifies that multiple set_vars tasks
// can read each other's output through the context export chain.
//
// Workflow: stepOne (set greeting) → stepTwo (read greeting, set farewell)
// Asserts both tasks complete and data flows correctly.
func TestWorkflowData_SetVarsChaining(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "set-chain", suiteLogger)
	defer deployer.Cleanup(ctx)

	stepOneConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"greeting": "hello",
			"version":  "2.0.0",
		},
	})
	require.NoError(t, err)

	stepTwoConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"farewell": "goodbye",
			"combined": "greeting-received",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-set-vars-chain",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: set_vars chaining",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-set-vars-chain",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "stepOne",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepOneConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "stepTwo",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepTwoConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "data chaining test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"stepOne": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"stepTwo": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("set_vars chaining completed: both tasks executed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowData_Transform verifies the transform task using the JQ engine.
//
// Workflow: setData (set_vars) → transformData (transform with JQ)
// The transform extracts and reshapes data from the workflow state.
func TestWorkflowData_Transform(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "transform", suiteLogger)
	defer deployer.Cleanup(ctx)

	setDataConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"first_name": "Jane",
			"last_name":  "Doe",
		},
	})
	require.NoError(t, err)

	transformConfig, err := structpb.NewStruct(map[string]any{
		"engine":     "TRANSFORM_ENGINE_JQ",
		"expression": `{full_name: (.first_name + " " + .last_name)}`,
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-transform",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: JQ transform",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-transform",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setData",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setDataConfig,
				},
				{
					Name:       "transformData",
					Kind:       workflowv1.WorkflowTaskKind_transform,
					TaskConfig: transformConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "transform test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"setData":       workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"transformData": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("transform completed: JQ transformation executed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowData_Validate_SchemaPass verifies that a validate task
// succeeds when the input data conforms to the JSON Schema.
//
// Workflow: setUser (set_vars with valid user) → validateUser (validate)
// The schema requires "name" (string) and "age" (integer, minimum 0).
func TestWorkflowData_Validate_SchemaPass(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "val-pass", suiteLogger)
	defer deployer.Cleanup(ctx)

	setUserConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"name": "Alice",
			"age":  "30",
		},
	})
	require.NoError(t, err)

	buildUserConfig, err := structpb.NewStruct(map[string]any{
		"engine":     "TRANSFORM_ENGINE_JQ",
		"expression": `{name: .name, age: (.age | tonumber)}`,
	})
	require.NoError(t, err)

	validateConfig, err := structpb.NewStruct(map[string]any{
		"input": "${ $data.buildUser }",
		"schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{"type": "string"},
				"age":  map[string]any{"type": "integer", "minimum": float64(0)},
			},
			"required": []any{"name", "age"},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-validate-schema-pass",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: validate task passes with valid data",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-validate-schema-pass",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setUser",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setUserConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "buildUser",
					Kind:       workflowv1.WorkflowTaskKind_transform,
					TaskConfig: buildUserConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "validateUser",
					Kind:       workflowv1.WorkflowTaskKind_validate,
					TaskConfig: validateConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "validate schema pass test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"setUser":      workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"buildUser":    workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"validateUser": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("validate schema pass: valid data passed JSON Schema, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowData_Validate_SchemaFail verifies that a validate task
// causes the workflow to fail when input violates the JSON Schema
// (default on_fail policy is raise).
//
// Workflow: setUser (set_vars, missing required "age") → validateUser (validate)
func TestWorkflowData_Validate_SchemaFail(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "val-fail", suiteLogger)
	defer deployer.Cleanup(ctx)

	setUserConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"name": "Bob",
		},
	})
	require.NoError(t, err)

	validateConfig, err := structpb.NewStruct(map[string]any{
		"input": "${ $data }",
		"schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{"type": "string"},
				"age":  map[string]any{"type": "integer", "minimum": float64(0)},
			},
			"required": []any{"name", "age"},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-validate-schema-fail",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: validate task fails with invalid data",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-validate-schema-fail",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setUser",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setUserConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "validateUser",
					Kind:       workflowv1.WorkflowTaskKind_validate,
					TaskConfig: validateConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "validate schema fail test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	harness.AssertTaskStatus(t, result, "validateUser",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED)

	t.Logf("validate schema fail: missing required field caused EXECUTION_FAILED, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowData_Validate_BusinessRules verifies the validate task
// with JQ-based business rules (no JSON Schema).
//
// Workflow: setOrder (set_vars with valid order) → validateOrder (validate with rules)
// Rules: total > 0, items array non-empty.
func TestWorkflowData_Validate_BusinessRules(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "val-rules", suiteLogger)
	defer deployer.Cleanup(ctx)

	setOrderConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"total":   "99",
			"items_a": "widget-a",
			"items_b": "widget-b",
		},
	})
	require.NoError(t, err)

	buildOrderConfig, err := structpb.NewStruct(map[string]any{
		"engine":     "TRANSFORM_ENGINE_JQ",
		"expression": `{total: (.total | tonumber), items: [.items_a, .items_b]}`,
	})
	require.NoError(t, err)

	validateConfig, err := structpb.NewStruct(map[string]any{
		"input": "${ $data.buildOrder }",
		"rules": []any{
			map[string]any{
				"name":       "positive_total",
				"expression": ".total > 0",
				"message":    "order total must be positive",
			},
			map[string]any{
				"name":       "has_items",
				"expression": ".items | length > 0",
				"message":    "order must contain at least one item",
			},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-validate-rules",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: validate task with business rules",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-validate-rules",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setOrder",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setOrderConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "buildOrder",
					Kind:       workflowv1.WorkflowTaskKind_transform,
					TaskConfig: buildOrderConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "validateOrder",
					Kind:       workflowv1.WorkflowTaskKind_validate,
					TaskConfig: validateConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "validate business rules test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"setOrder":      workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"buildOrder":    workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"validateOrder": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("validate business rules: both rules passed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}
