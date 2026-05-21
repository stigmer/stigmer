package workflowexecution

import (
	"testing"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// createTestExecutionWithTasksUnique creates a unique execution in the given
// phase with specific task entries in Status.Tasks. Needed for testing
// ValidateHumanInputTask which inspects the task list.
func createTestExecutionWithTasksUnique(
	t *testing.T,
	controller *WorkflowExecutionController,
	s store.Store,
	phase workflowexecutionv1.ExecutionPhase,
	tasks []*workflowexecutionv1.WorkflowTask,
	suffix string,
) *workflowexecutionv1.WorkflowExecution {
	t.Helper()

	execution := createTestExecutionWithPhaseUnique(t, controller, s, phase, suffix)

	if len(tasks) > 0 {
		updated, err := controller.UpdateStatus(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
				ExecutionId: execution.Metadata.Id,
				Status: &workflowexecutionv1.WorkflowExecutionStatus{
					Phase: phase,
					Tasks: tasks,
				},
			})
		if err != nil {
			t.Fatalf("Failed to seed tasks on execution: %v", err)
		}
		return updated
	}

	return execution
}

func TestWorkflowExecutionController_SubmitWorkflowTaskApproval(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// =========================================================================
	// Step 1: ValidateTaskApprovalInput
	// =========================================================================

	t.Run("empty execution_id - should fail at validation", func(t *testing.T) {
		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: "",
				TaskName:    "reviewGate",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when execution_id is empty")
		}
	})

	t.Run("empty task_name - should fail at validation", func(t *testing.T) {
		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: "some-id",
				TaskName:    "",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when task_name is empty")
		}
	})

	t.Run("empty outcome - should fail at validation", func(t *testing.T) {
		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: "some-id",
				TaskName:    "reviewGate",
				Outcome:     "",
			})
		if err == nil {
			t.Error("Expected error when outcome is empty")
		}
	})

	// =========================================================================
	// Step 2: LoadExecutionForApproval
	// =========================================================================

	t.Run("non-existent execution_id - should fail at load", func(t *testing.T) {
		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: "non-existent-id",
				TaskName:    "reviewGate",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when execution does not exist")
		}
	})

	// =========================================================================
	// Step 3: ValidateApprovalSignalable (terminal phase rejection)
	// =========================================================================

	t.Run("submit to COMPLETED execution - should fail at phase check", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "approval-completed")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "reviewGate",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when submitting to COMPLETED execution")
		}
	})

	t.Run("submit to FAILED execution - should fail at phase check", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "approval-failed")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "reviewGate",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when submitting to FAILED execution")
		}
	})

	t.Run("submit to CANCELLED execution - should fail at phase check", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, "approval-cancelled")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "reviewGate",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when submitting to CANCELLED execution")
		}
	})

	t.Run("submit to TERMINATED execution - should fail at phase check", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, "approval-terminated")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "reviewGate",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when submitting to TERMINATED execution")
		}
	})

	// =========================================================================
	// Step 4: ValidateHumanInputTask
	// =========================================================================

	t.Run("task not found in execution - should fail", func(t *testing.T) {
		execution := createTestExecutionWithTasksUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{
				{
					TaskName: "someOtherTask",
					TaskType: workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_APPROVAL,
					Status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL,
				},
			},
			"approval-task-not-found")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "nonexistentTask",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when task is not found in execution status")
		}
	})

	t.Run("task exists but is not human_input type - should fail", func(t *testing.T) {
		execution := createTestExecutionWithTasksUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{
				{
					TaskName: "apiCallTask",
					TaskType: workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_API_CALL,
					Status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS,
				},
			},
			"approval-wrong-type")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "apiCallTask",
				Outcome:     "approve",
			})
		if err == nil {
			t.Error("Expected error when task is not a human_input task")
		}
	})

	// =========================================================================
	// Step 5: SendTaskApprovalSignal (validation passes, Temporal fails)
	// =========================================================================

	t.Run("PENDING execution with valid human_input task - validation passes, Temporal fails", func(t *testing.T) {
		execution := createTestExecutionWithTasksUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING,
			[]*workflowexecutionv1.WorkflowTask{
				{
					TaskName: "awaitApproval",
					TaskType: workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_APPROVAL,
					Status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL,
				},
			},
			"approval-pending-valid")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "awaitApproval",
				Outcome:     "approve",
				Reviewer:    "test-user",
			})

		if err == nil {
			t.Error("Expected error since workflow creator is not configured")
		}
		t.Logf("Got expected error for PENDING execution (Temporal step): %v", err)
	})

	t.Run("IN_PROGRESS execution with valid human_input task - validation passes, Temporal fails", func(t *testing.T) {
		execution := createTestExecutionWithTasksUnique(t, controller, store,
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*workflowexecutionv1.WorkflowTask{
				{
					TaskName: "reviewStep",
					TaskType: workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_APPROVAL,
					Status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL,
				},
			},
			"approval-inprogress-valid")

		_, err := controller.SubmitWorkflowTaskApproval(contextWithWorkflowExecutionKind(),
			&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
				ExecutionId: execution.Metadata.Id,
				TaskName:    "reviewStep",
				Outcome:     "reject",
				Reviewer:    "integration-test",
			})

		if err == nil {
			t.Error("Expected error since workflow creator is not configured")
		}
		t.Logf("Got expected error for IN_PROGRESS execution (Temporal step): %v", err)
	})
}
