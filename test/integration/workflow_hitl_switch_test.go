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

// TestWorkflowHITL_ApprovalGate_ApproveRoute verifies the approval gate pattern
// where a human_input task exports its outcome into $context, followed by a
// switch_case that routes to the approved branch using single-quoted string
// comparison in the when condition.
func TestWorkflowHITL_ApprovalGate_ApproveRoute(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-switch-approve", suiteLogger)
	defer deployer.Cleanup(ctx)

	gateConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Approve or reject this request",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "approved",
				"when": "${ $context.gate.outcome == 'approve' }",
				"then": "handleApproved",
			},
			map[string]any{
				"name": "default",
				"then": "handleRejected",
			},
		},
	})
	require.NoError(t, err)

	handleApprovedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "approved",
		},
	})
	require.NoError(t, err)

	handleRejectedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "rejected",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-switch-approve",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: approval gate with switch_case routing to approved branch",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-switch-approve",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "gate",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: gateConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "routeDecision"},
				},
				{
					Name:       "routeDecision",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleApproved",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleApprovedConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleRejected",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleRejectedConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "approval gate approve route")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "gate", 90*time.Second)
	require.NoError(t, err, "gate task should reach WAITING_APPROVAL")

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "gate",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "gate",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeDecision",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleApproved",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	rejected := findTaskInExecution(result, "handleRejected")
	if rejected != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			rejected.GetStatus(), "handleRejected should not have completed when approve was selected")
	}

	t.Logf("approval gate: approve outcome routed to handleApproved, handleRejected skipped")
}

// TestWorkflowHITL_ApprovalGate_RejectRoute verifies the approval gate pattern
// where submitting a "reject" outcome causes the switch_case default branch to
// execute, routing to the rejected handler.
func TestWorkflowHITL_ApprovalGate_RejectRoute(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-switch-reject", suiteLogger)
	defer deployer.Cleanup(ctx)

	gateConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Approve or reject this request",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "approved",
				"when": "${ $context.gate.outcome == 'approve' }",
				"then": "handleApproved",
			},
			map[string]any{
				"name": "default",
				"then": "handleRejected",
			},
		},
	})
	require.NoError(t, err)

	handleApprovedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "approved",
		},
	})
	require.NoError(t, err)

	handleRejectedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "rejected",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-switch-reject",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: approval gate with switch_case routing to rejected branch",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-switch-reject",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "gate",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: gateConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "routeDecision"},
				},
				{
					Name:       "routeDecision",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleApproved",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleApprovedConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleRejected",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleRejectedConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "approval gate reject route")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "gate", 90*time.Second)
	require.NoError(t, err, "gate task should reach WAITING_APPROVAL")

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "gate",
			Outcome:     "reject",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "gate",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeDecision",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleRejected",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	approved := findTaskInExecution(result, "handleApproved")
	if approved != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			approved.GetStatus(), "handleApproved should not have completed when reject was selected")
	}

	t.Logf("approval gate: reject outcome routed to handleRejected via default branch")
}

// TestWorkflowHITL_ApprovalGate_ThreeWay verifies a three-way approval gate
// where human_input offers approve/escalate/reject outcomes and the switch_case
// routes each outcome to a distinct branch using single-quoted string comparisons.
func TestWorkflowHITL_ApprovalGate_ThreeWay(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-switch-3way", suiteLogger)
	defer deployer.Cleanup(ctx)

	gateConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Choose an action: approve, escalate, or reject",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "escalate", "label": "Escalate"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "approved",
				"when": "${ $context.gate.outcome == 'approve' }",
				"then": "handleApproved",
			},
			map[string]any{
				"name": "escalated",
				"when": "${ $context.gate.outcome == 'escalate' }",
				"then": "handleEscalated",
			},
			map[string]any{
				"name": "rejected",
				"when": "${ $context.gate.outcome == 'reject' }",
				"then": "handleRejected",
			},
		},
	})
	require.NoError(t, err)

	handleApprovedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "approved",
		},
	})
	require.NoError(t, err)

	handleEscalatedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "escalated",
		},
	})
	require.NoError(t, err)

	handleRejectedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "rejected",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-switch-3way",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: three-way approval gate with switch_case routing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-switch-3way",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "gate",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: gateConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "routeDecision"},
				},
				{
					Name:       "routeDecision",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleApproved",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleApprovedConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleEscalated",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleEscalatedConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleRejected",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleRejectedConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "three-way approval gate")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "gate", 90*time.Second)
	require.NoError(t, err, "gate task should reach WAITING_APPROVAL")

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "gate",
			Outcome:     "escalate",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "gate",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeDecision",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleEscalated",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	approved := findTaskInExecution(result, "handleApproved")
	if approved != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			approved.GetStatus(), "handleApproved should not have completed when escalate was selected")
	}

	rejected := findTaskInExecution(result, "handleRejected")
	if rejected != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			rejected.GetStatus(), "handleRejected should not have completed when escalate was selected")
	}

	t.Logf("three-way gate: escalate outcome routed to handleEscalated, other branches skipped")
}

// TestWorkflowHITL_ApprovalGate_FormDataInCondition verifies that form_data
// submitted through the approval API is accessible in switch_case conditions
// via $context.gate.form_data, enabling routing based on user-provided form fields.
func TestWorkflowHITL_ApprovalGate_FormDataInCondition(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-switch-form", suiteLogger)
	defer deployer.Cleanup(ctx)

	gateConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Review and set priority",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"form_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"priority": map[string]any{"type": "string"},
			},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "highPriority",
				"when": "${ $context.gate.form_data.priority == 'high' }",
				"then": "handleHighPriority",
			},
			map[string]any{
				"name": "default",
				"then": "handleNormalPriority",
			},
		},
	})
	require.NoError(t, err)

	handleHighConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "high-priority",
		},
	})
	require.NoError(t, err)

	handleNormalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "normal-priority",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-switch-form",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: approval gate with form_data-based switch routing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-switch-form",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "gate",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: gateConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "routeDecision"},
				},
				{
					Name:       "routeDecision",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleHighPriority",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleHighConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleNormalPriority",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleNormalConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "form data condition gate")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "gate", 90*time.Second)
	require.NoError(t, err, "gate task should reach WAITING_APPROVAL")

	formData, err := structpb.NewStruct(map[string]any{
		"priority": "high",
	})
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "gate",
			Outcome:     "approve",
			FormData:    formData,
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "gate",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeDecision",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleHighPriority",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	normal := findTaskInExecution(result, "handleNormalPriority")
	if normal != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			normal.GetStatus(), "handleNormalPriority should not have completed when priority=high")
	}

	t.Logf("form data gate: priority=high routed to handleHighPriority branch")
}
