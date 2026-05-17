//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowContinueAsNew_LargeTaskCount verifies that a workflow with
// many tasks completes successfully even when the Temporal history grows
// large enough to trigger a continue-as-new (CAN).
//
// The workflow runner checks for CAN between tasks and resumes from the
// correct position. This test uses a large number of set_vars tasks to
// build up history events, verifying the CAN mechanism or at least that
// many-task workflows complete without failure.
//
// Workflow: 50 sequential set_vars tasks, each writing a unique variable.
func TestWorkflowContinueAsNew_LargeTaskCount(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "can-large", suiteLogger)
	defer deployer.Cleanup(ctx)

	const taskCount = 50
	tasks := make([]*workflowv1.WorkflowTask, 0, taskCount)

	for i := 0; i < taskCount; i++ {
		varName := fmt.Sprintf("var_%d", i)
		cfg, err := structpb.NewStruct(map[string]any{
			"variables": map[string]any{
				varName: float64(i),
			},
		})
		require.NoError(t, err)

		taskName := fmt.Sprintf("step_%02d", i)
		task := &workflowv1.WorkflowTask{
			Name:       taskName,
			Kind:       workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: cfg,
		}
		if i == taskCount-1 {
			task.Export = &workflowv1.Export{As: "${ . }"}
		}
		tasks = append(tasks, task)
	}

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-can-large",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: many tasks to exercise continue-as-new",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-can-large",
				Version:   "1.0.0",
			},
			Tasks: tasks,
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "CAN large task count test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	completedTasks := 0
	for _, task := range result.GetStatus().GetTasks() {
		if task.GetStatus() == workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED {
			completedTasks++
		}
	}

	t.Logf("CAN large task count: %d/%d tasks completed, total reported=%d",
		completedTasks, taskCount, len(result.GetStatus().GetTasks()))
}
