package workflowexecution

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

func TestBuildNewStateWithStatus_PendingApprovals_GuardedUpdate(t *testing.T) {
	existingApproval := &workflowexecutionv1.WorkflowPendingApproval{
		Approval: &agentexecutionv1.PendingApproval{
			ToolCallId: "tc_123",
			ToolName:   "deploy_code",
			Message:    "Deploy code to production?",
		},
		ChildAgentExecutionId: "aex_abc",
	}

	makeExisting := func() *workflowexecutionv1.WorkflowExecution {
		return &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase:            workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{existingApproval},
			},
		}
	}

	t.Run("flag_false_preserves_existing_approvals", func(t *testing.T) {
		existing := makeExisting()
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			},
			UpdatePendingApprovals: false,
		}

		result := executeMerge(t, existing, input)

		require.Len(t, result.Status.PendingApprovals, 1, "approvals should be preserved when flag is false")
		assert.Equal(t, "tc_123", result.Status.PendingApprovals[0].Approval.ToolCallId)
	})

	t.Run("flag_absent_preserves_existing_approvals", func(t *testing.T) {
		existing := makeExisting()
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			},
			// UpdatePendingApprovals not set — proto3 default is false
		}

		result := executeMerge(t, existing, input)

		require.Len(t, result.Status.PendingApprovals, 1, "approvals should be preserved when flag is absent")
	})

	t.Run("flag_true_replaces_with_new_approvals", func(t *testing.T) {
		existing := makeExisting()
		newApproval := &workflowexecutionv1.WorkflowPendingApproval{
			Approval: &agentexecutionv1.PendingApproval{
				ToolCallId: "tc_456",
				ToolName:   "read_file",
			},
			ChildAgentExecutionId: "aex_def",
		}
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{newApproval},
			},
			UpdatePendingApprovals: true,
		}

		result := executeMerge(t, existing, input)

		require.Len(t, result.Status.PendingApprovals, 1)
		assert.Equal(t, "tc_456", result.Status.PendingApprovals[0].Approval.ToolCallId)
	})

	t.Run("flag_true_empty_list_clears_approvals", func(t *testing.T) {
		existing := makeExisting()
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{},
			},
			UpdatePendingApprovals: true,
		}

		result := executeMerge(t, existing, input)

		assert.Empty(t, result.Status.PendingApprovals, "approvals should be cleared when flag is true + empty list")
	})

	t.Run("concurrent_event_emission_does_not_clobber_approvals", func(t *testing.T) {
		existing := makeExisting()
		// Simulates what workflow-event-activities.ts sends: tasks + phase, no approval flag
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
				Tasks: []*workflowexecutionv1.WorkflowTask{
					{TaskName: "some_task", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
				},
			},
			// UpdatePendingApprovals not set (false) — normal event emission
		}

		result := executeMerge(t, existing, input)

		require.Len(t, result.Status.PendingApprovals, 1, "event emission must not clear active approvals")
		assert.Equal(t, "tc_123", result.Status.PendingApprovals[0].Approval.ToolCallId)
		// Verify tasks were still updated
		require.Len(t, result.Status.Tasks, 1)
		assert.Equal(t, "some_task", result.Status.Tasks[0].TaskName)
	})
}

// executeMerge runs the BuildNewStateWithStatusStep in isolation.
func executeMerge(
	t *testing.T,
	existing *workflowexecutionv1.WorkflowExecution,
	input *workflowexecutionv1.WorkflowExecutionUpdateStatusInput,
) *workflowexecutionv1.WorkflowExecution {
	t.Helper()

	step := &BuildNewStateWithStatusStep{}
	ctx := pipeline.NewRequestContext(context.Background(), input)
	ctx.Set("existingExecution", proto.Clone(existing))

	err := step.Execute(ctx)
	require.NoError(t, err)

	result, ok := ctx.Get("execution").(*workflowexecutionv1.WorkflowExecution)
	require.True(t, ok, "execution should be set in context after merge")
	return result
}
