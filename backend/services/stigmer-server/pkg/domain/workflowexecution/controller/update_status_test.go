package workflowexecution

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

func wfApproval(childID, toolCallID string) *workflowexecutionv1.WorkflowPendingApproval {
	return &workflowexecutionv1.WorkflowPendingApproval{
		Approval:              &agentexecutionv1.PendingApproval{ToolCallId: toolCallID, ToolName: "deploy_code"},
		ChildAgentExecutionId: childID,
	}
}

func wfFileReview(childID string, changeSetIDs ...string) *workflowexecutionv1.WorkflowPendingFileReview {
	return &workflowexecutionv1.WorkflowPendingFileReview{
		ChildAgentExecutionId: childID,
		ChangeSetId:           changeSetIDs,
	}
}

func TestBuildNewStateWithStatus_PendingApprovals_PerChildMerge(t *testing.T) {
	makeExisting := func() *workflowexecutionv1.WorkflowExecution {
		return &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase:            workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{wfApproval("aex_abc", "tc_123")},
			},
		}
	}

	t.Run("flag_false_preserves_existing_approvals", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId:            "wfx_test",
			Status:                 &workflowexecutionv1.WorkflowExecutionStatus{Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS},
			UpdatePendingApprovals: false,
		}
		result := executeMerge(t, makeExisting(), input)
		require.Len(t, result.Status.PendingApprovals, 1, "approvals preserved when flag is false")
		assert.Equal(t, "tc_123", result.Status.PendingApprovals[0].Approval.ToolCallId)
	})

	t.Run("flag_absent_preserves_existing_approvals", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status:      &workflowexecutionv1.WorkflowExecutionStatus{Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS},
		}
		result := executeMerge(t, makeExisting(), input)
		require.Len(t, result.Status.PendingApprovals, 1, "approvals preserved when flag is absent")
	})

	t.Run("scoped_write_replaces_only_that_childs_approvals", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{wfApproval("aex_abc", "tc_456")},
			},
			UpdatePendingApprovals:             true,
			PendingUpdateChildAgentExecutionId: "aex_abc",
		}
		result := executeMerge(t, makeExisting(), input)
		require.Len(t, result.Status.PendingApprovals, 1)
		assert.Equal(t, "tc_456", result.Status.PendingApprovals[0].Approval.ToolCallId, "child's own entry replaced")
	})

	t.Run("scoped_empty_list_clears_only_that_child", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{},
			},
			UpdatePendingApprovals:             true,
			PendingUpdateChildAgentExecutionId: "aex_abc",
		}
		result := executeMerge(t, makeExisting(), input)
		assert.Empty(t, result.Status.PendingApprovals, "scoped empty list clears the child")
	})

	// The core regression: two parallel children must not clobber each other.
	t.Run("parallel_children_not_clobbered_on_set", func(t *testing.T) {
		existing := &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{
					wfApproval("aex_A", "tc_A"),
					wfApproval("aex_B", "tc_B"),
				},
			},
		}
		// Child B re-writes only its own approval; child A must survive.
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{wfApproval("aex_B", "tc_B2")},
			},
			UpdatePendingApprovals:             true,
			PendingUpdateChildAgentExecutionId: "aex_B",
		}
		result := executeMerge(t, existing, input)
		require.Len(t, result.Status.PendingApprovals, 2, "sibling child A must survive child B's write")
		byChild := map[string]string{}
		for _, pa := range result.Status.PendingApprovals {
			byChild[pa.GetChildAgentExecutionId()] = pa.GetApproval().GetToolCallId()
		}
		assert.Equal(t, "tc_A", byChild["aex_A"], "child A preserved")
		assert.Equal(t, "tc_B2", byChild["aex_B"], "child B replaced")
	})

	t.Run("scoped_clear_preserves_siblings", func(t *testing.T) {
		existing := &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{
					wfApproval("aex_A", "tc_A"),
					wfApproval("aex_B", "tc_B"),
				},
			},
		}
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals: []*workflowexecutionv1.WorkflowPendingApproval{},
			},
			UpdatePendingApprovals:             true,
			PendingUpdateChildAgentExecutionId: "aex_B",
		}
		result := executeMerge(t, existing, input)
		require.Len(t, result.Status.PendingApprovals, 1, "clearing B leaves A")
		assert.Equal(t, "aex_A", result.Status.PendingApprovals[0].GetChildAgentExecutionId())
	})

	t.Run("concurrent_event_emission_does_not_clobber_approvals", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
				Tasks: []*workflowexecutionv1.WorkflowTask{{TaskName: "some_task", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED}},
			},
		}
		result := executeMerge(t, makeExisting(), input)
		require.Len(t, result.Status.PendingApprovals, 1, "event emission must not clear active approvals")
		require.Len(t, result.Status.Tasks, 1)
		assert.Equal(t, "some_task", result.Status.Tasks[0].TaskName)
	})
}

func TestBuildNewStateWithStatus_PendingFileReviews_PerChildMerge(t *testing.T) {
	makeExisting := func() *workflowexecutionv1.WorkflowExecution {
		return &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase:              workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{wfFileReview("aex_abc", "fcs_1")},
			},
		}
	}

	t.Run("flag_false_preserves_existing_file_reviews", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status:      &workflowexecutionv1.WorkflowExecutionStatus{Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS},
		}
		result := executeMerge(t, makeExisting(), input)
		require.Len(t, result.Status.PendingFileReviews, 1, "file reviews preserved when flag is false")
	})

	t.Run("scoped_write_replaces_only_that_childs_file_reviews", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{wfFileReview("aex_abc", "fcs_2", "fcs_3")},
			},
			UpdatePendingFileReviews:           true,
			PendingUpdateChildAgentExecutionId: "aex_abc",
		}
		result := executeMerge(t, makeExisting(), input)
		require.Len(t, result.Status.PendingFileReviews, 1)
		assert.Equal(t, []string{"fcs_2", "fcs_3"}, result.Status.PendingFileReviews[0].GetChangeSetId())
	})

	t.Run("parallel_children_not_clobbered", func(t *testing.T) {
		existing := &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{
					wfFileReview("aex_A", "fcs_A"),
					wfFileReview("aex_B", "fcs_B"),
				},
			},
		}
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{wfFileReview("aex_B", "fcs_B2")},
			},
			UpdatePendingFileReviews:           true,
			PendingUpdateChildAgentExecutionId: "aex_B",
		}
		result := executeMerge(t, existing, input)
		require.Len(t, result.Status.PendingFileReviews, 2, "sibling child A must survive child B's file-review write")
	})

	t.Run("scoped_empty_list_clears_only_that_child", func(t *testing.T) {
		existing := &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{
					wfFileReview("aex_A", "fcs_A"),
					wfFileReview("aex_B", "fcs_B"),
				},
			},
		}
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{},
			},
			UpdatePendingFileReviews:           true,
			PendingUpdateChildAgentExecutionId: "aex_A",
		}
		result := executeMerge(t, existing, input)
		require.Len(t, result.Status.PendingFileReviews, 1, "clearing A leaves B")
		assert.Equal(t, "aex_B", result.Status.PendingFileReviews[0].GetChildAgentExecutionId())
	})

	t.Run("approvals_and_file_reviews_are_independent", func(t *testing.T) {
		existing := &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingApprovals:   []*workflowexecutionv1.WorkflowPendingApproval{wfApproval("aex_abc", "tc_1")},
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{wfFileReview("aex_abc", "fcs_1")},
			},
		}
		// A file-review write for the child must not disturb the same child's approvals.
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{},
			},
			UpdatePendingFileReviews:           true,
			PendingUpdateChildAgentExecutionId: "aex_abc",
		}
		result := executeMerge(t, existing, input)
		require.Len(t, result.Status.PendingApprovals, 1, "approvals untouched by a file-review-only write")
		assert.Empty(t, result.Status.PendingFileReviews, "file review cleared")
	})
}

func TestMergePendingByChild(t *testing.T) {
	childOf := func(s string) string { return s } // entries are their own child id for this pure test

	t.Run("replaces_scoped_child_preserves_siblings", func(t *testing.T) {
		got := mergePendingByChild([]string{"A", "B"}, []string{"B"}, childOf, "B")
		assert.Equal(t, []string{"A", "B"}, got)
	})
	t.Run("empty_incoming_clears_scoped_child", func(t *testing.T) {
		got := mergePendingByChild([]string{"A", "B"}, nil, childOf, "B")
		assert.Equal(t, []string{"A"}, got)
	})
	t.Run("adds_new_child", func(t *testing.T) {
		got := mergePendingByChild([]string{"A"}, []string{"C"}, childOf, "C")
		assert.Equal(t, []string{"A", "C"}, got)
	})
	t.Run("empty_existing", func(t *testing.T) {
		got := mergePendingByChild(nil, []string{"A"}, childOf, "A")
		assert.Equal(t, []string{"A"}, got)
	})
}

// executeMerge runs the BuildNewStateWithStatusStep in isolation.
// TestBuildNewStateWithStatus_StatusAuditBump pins the recents-ordering
// contract shared with the cloud's WorkflowExecutionUpdateStatusHandler:
// statusAudit.updatedAt is bumped ONLY on phase transitions, never on
// task-progress heartbeats. If heartbeats bumped it, a long-running
// execution would perpetually sort above freshly created ones in the
// recents sidebar (ActivityQueryController orders by this field).
func TestBuildNewStateWithStatus_StatusAuditBump(t *testing.T) {
	initialStamp := timestamppb.New(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	makeExisting := func() *workflowexecutionv1.WorkflowExecution {
		return &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
				Audit: &apiresource.ApiResourceAudit{
					StatusAudit: &apiresource.ApiResourceAuditInfo{
						UpdatedAt: initialStamp,
						Event:     "created",
					},
				},
			},
		}
	}

	t.Run("heartbeat_same_phase_does_not_bump", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
				Tasks: []*workflowexecutionv1.WorkflowTask{{TaskName: "step-1"}},
			},
		}
		result := executeMerge(t, makeExisting(), input)
		assert.True(t, proto.Equal(initialStamp, result.Status.Audit.StatusAudit.UpdatedAt),
			"a task-progress heartbeat with an unchanged phase must not bump statusAudit.updatedAt")
		assert.Equal(t, "created", result.Status.Audit.StatusAudit.Event)
	})

	t.Run("unspecified_phase_does_not_bump", func(t *testing.T) {
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Tasks: []*workflowexecutionv1.WorkflowTask{{TaskName: "step-1"}},
			},
		}
		result := executeMerge(t, makeExisting(), input)
		assert.True(t, proto.Equal(initialStamp, result.Status.Audit.StatusAudit.UpdatedAt),
			"an update that does not set a phase must not bump statusAudit.updatedAt")
	})

	t.Run("phase_transition_bumps", func(t *testing.T) {
		before := time.Now().Add(-time.Second)
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			},
		}
		result := executeMerge(t, makeExisting(), input)
		bumped := result.Status.Audit.StatusAudit.UpdatedAt
		require.NotNil(t, bumped)
		assert.True(t, bumped.AsTime().After(before),
			"a phase transition must stamp statusAudit.updatedAt with the current time; got %v", bumped.AsTime())
		assert.Equal(t, "updated", result.Status.Audit.StatusAudit.Event)
	})

	t.Run("phase_transition_initializes_missing_audit", func(t *testing.T) {
		existing := &workflowexecutionv1.WorkflowExecution{
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			},
		}
		input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: "wfx_test",
			Status: &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			},
		}
		result := executeMerge(t, existing, input)
		require.NotNil(t, result.Status.Audit.GetStatusAudit().GetUpdatedAt(),
			"the bump must initialize the audit chain when the stored row has none")
	})
}

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
