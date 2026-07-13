package workflowexecution

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// seedExecutionWithTasks persists a WorkflowExecution with the given phase and
// task snapshot, mirroring what the workflow-runner writes through UpdateStatus.
func seedExecutionWithTasks(
	t *testing.T,
	s store.Store,
	id, name, requester string,
	phase workflowexecutionv1.ExecutionPhase,
	tasks []*workflowexecutionv1.WorkflowTask,
) {
	t.Helper()

	execution := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: name,
			Slug: id,
			Org:  "test-org",
		},
		Spec: &workflowexecutionv1.WorkflowExecutionSpec{
			WorkflowInstanceId: "wfi-test-instance",
			TriggerMessage:     "Test trigger message",
		},
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: phase,
			Tasks: tasks,
			Audit: &apiresource.ApiResourceAudit{
				SpecAudit: &apiresource.ApiResourceAuditInfo{
					CreatedBy: &apiresource.ApiResourceAuditActor{Id: requester},
				},
			},
		},
	}

	if err := s.SaveResource(
		contextWithWorkflowExecutionKind(),
		apiresourcekind.ApiResourceKind_workflow_execution,
		id,
		execution,
	); err != nil {
		t.Fatalf("failed to seed workflow execution %q: %v", id, err)
	}
}

// waitingTask builds a WorkflowTask in WAITING_APPROVAL as the runner's task
// status accumulator emits it: composite task_id ("name:attempt") alongside
// the plain task_name, plus the review-surface ui_hint when the gate declared one.
func waitingTask(name, uiHint string) *workflowexecutionv1.WorkflowTask {
	return &workflowexecutionv1.WorkflowTask{
		TaskId:    name + ":1",
		TaskName:  name,
		TaskType:  workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_APPROVAL,
		Status:    workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL,
		StartedAt: "2026-07-13T10:00:00Z",
		UiHint:    uiHint,
	}
}

func completedTask(name string) *workflowexecutionv1.WorkflowTask {
	return &workflowexecutionv1.WorkflowTask{
		TaskId:   name + ":1",
		TaskName: name,
		Status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	}
}

func TestWorkflowExecutionController_ListPendingApprovals(t *testing.T) {
	t.Run("maps waiting task fields including ui_hint and plain task_name", func(t *testing.T) {
		controller, s := setupTestController(t)
		defer s.Close()

		seedExecutionWithTasks(t, s, "wfx-gate-1", "Article Pipeline", "usr-alice",
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{
				completedTask("draft"),
				waitingTask("reviewDraft", "article-diff"),
			},
		)

		list, err := controller.ListPendingApprovals(
			contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.ListPendingApprovalsRequest{Org: "test-org"},
		)
		require.NoError(t, err)
		require.Len(t, list.GetEntries(), 1)

		entry := list.GetEntries()[0]
		assert.Equal(t, "wfx-gate-1", entry.GetExecutionId())
		assert.Equal(t, "Article Pipeline", entry.GetWorkflowName())
		assert.Equal(t, "reviewDraft", entry.GetTaskName(),
			"task_name must be the plain name usable with submitWorkflowTaskApproval, not the composite task_id")
		assert.Equal(t, "usr-alice", entry.GetRequester())
		assert.Equal(t, "article-diff", entry.GetUiHint())
		require.NotNil(t, entry.GetRequestedAt())
		wantRequestedAt, err := time.Parse(time.RFC3339, "2026-07-13T10:00:00Z")
		require.NoError(t, err)
		assert.Equal(t, wantRequestedAt.Unix(), entry.GetRequestedAt().GetSeconds())
		assert.Equal(t, int32(1), list.GetTotalCount())
	})

	t.Run("ui_hint is empty when the gate declared no hint", func(t *testing.T) {
		controller, s := setupTestController(t)
		defer s.Close()

		seedExecutionWithTasks(t, s, "wfx-gate-2", "Plain Gate", "usr-bob",
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{waitingTask("approve", "")},
		)

		list, err := controller.ListPendingApprovals(
			contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.ListPendingApprovalsRequest{Org: "test-org"},
		)
		require.NoError(t, err)
		require.Len(t, list.GetEntries(), 1)
		assert.Empty(t, list.GetEntries()[0].GetUiHint())
	})

	t.Run("excludes tasks that are not waiting for approval", func(t *testing.T) {
		controller, s := setupTestController(t)
		defer s.Close()

		seedExecutionWithTasks(t, s, "wfx-no-gate", "No Gate", "usr-carol",
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{
				completedTask("step1"),
				completedTask("step2"),
			},
		)

		list, err := controller.ListPendingApprovals(
			contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.ListPendingApprovalsRequest{Org: "test-org"},
		)
		require.NoError(t, err)
		assert.Empty(t, list.GetEntries())
		assert.Equal(t, int32(0), list.GetTotalCount())
	})

	t.Run("excludes executions that are no longer in progress", func(t *testing.T) {
		controller, s := setupTestController(t)
		defer s.Close()

		// A completed execution may retain a stale waiting_approval task in its
		// snapshot (e.g. timeout auto-resolution); it must not surface as pending.
		seedExecutionWithTasks(t, s, "wfx-done", "Finished", "usr-dave",
			workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			[]*workflowexecutionv1.WorkflowTask{waitingTask("gate", "article-diff")},
		)

		list, err := controller.ListPendingApprovals(
			contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.ListPendingApprovalsRequest{Org: "test-org"},
		)
		require.NoError(t, err)
		assert.Empty(t, list.GetEntries())
	})

	t.Run("aggregates approvals across executions and reports total_count", func(t *testing.T) {
		controller, s := setupTestController(t)
		defer s.Close()

		seedExecutionWithTasks(t, s, "wfx-a", "Workflow A", "usr-alice",
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{waitingTask("gateA", "article-diff")},
		)
		seedExecutionWithTasks(t, s, "wfx-b", "Workflow B", "usr-bob",
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{waitingTask("gateB", "infra-proposal")},
		)

		list, err := controller.ListPendingApprovals(
			contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.ListPendingApprovalsRequest{Org: "test-org"},
		)
		require.NoError(t, err)
		require.Len(t, list.GetEntries(), 2)
		assert.Equal(t, int32(2), list.GetTotalCount())

		hintsByTask := map[string]string{}
		for _, entry := range list.GetEntries() {
			hintsByTask[entry.GetTaskName()] = entry.GetUiHint()
		}
		assert.Equal(t, "article-diff", hintsByTask["gateA"])
		assert.Equal(t, "infra-proposal", hintsByTask["gateB"])
	})

	t.Run("truncates entries to page_size but total_count reflects all matches", func(t *testing.T) {
		controller, s := setupTestController(t)
		defer s.Close()

		seedExecutionWithTasks(t, s, "wfx-many", "Many Gates", "usr-eve",
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{
				waitingTask("gate1", ""),
				waitingTask("gate2", ""),
				waitingTask("gate3", ""),
			},
		)

		list, err := controller.ListPendingApprovals(
			contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.ListPendingApprovalsRequest{Org: "test-org", PageSize: 2},
		)
		require.NoError(t, err)
		assert.Len(t, list.GetEntries(), 2)
		assert.Equal(t, int32(3), list.GetTotalCount())
	})
}
