package workflowexecution

import (
	"fmt"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// Helper to create a unique workflow execution in a specific phase
func createTestExecutionWithPhaseUnique(t *testing.T, controller *WorkflowExecutionController, s store.Store, phase workflowexecutionv1.ExecutionPhase, suffix string) *workflowexecutionv1.WorkflowExecution {
	// Create unique test workflow and instance first
	workflow := createUniqueTestWorkflow(t, s, suffix)
	instance := createUniqueTestWorkflowInstance(t, s, workflow.Metadata.Id, suffix)

	// Create a unique name for the execution
	uniqueName := fmt.Sprintf("Test Execution %s %d", suffix, time.Now().UnixNano())

	// Seed the execution directly into the store. Create now requires a connected
	// workflow engine (see ensureEngineAvailableStep), so these lifecycle tests seed
	// the execution they operate on rather than driving it through Create. The fields
	// mirror what a successful Create would persist (id, slug, resolved workflow_id,
	// PENDING phase); phase transitions below still go through UpdateStatus.
	executionID := fmt.Sprintf("wex-test-%s-%d", suffix, time.Now().UnixNano())
	created := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   executionID,
			Name: uniqueName,
			Slug: executionID,
			Org:  "test-org",
		},
		Spec: &workflowexecutionv1.WorkflowExecutionSpec{
			WorkflowInstanceId: instance.Metadata.Id,
			WorkflowId:         workflow.Metadata.Id,
			TriggerMessage:     "Test trigger",
		},
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		},
	}
	if err := s.SaveResource(contextWithWorkflowExecutionKind(), apiresourcekind.ApiResourceKind_workflow_execution, executionID, created); err != nil {
		t.Fatalf("Failed to seed test execution: %v", err)
	}

	// Update the phase via UpdateStatus if needed (Update only handles spec changes)
	if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING {
		statusUpdate := &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: phase,
		}
		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
			statusUpdate.Error = "Simulated failure for testing"
		}
		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
			statusUpdate.Error = "Previously terminated"
			statusUpdate.CompletedAt = time.Now().Format(time.RFC3339)
		}
		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
			statusUpdate.CompletedAt = time.Now().Format(time.RFC3339)
		}
		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
			statusUpdate.CompletedAt = time.Now().Format(time.RFC3339)
		}
		updated, err := controller.UpdateStatus(contextWithWorkflowExecutionKind(), &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
			ExecutionId: created.Metadata.Id,
			Status:      statusUpdate,
		})
		if err != nil {
			t.Fatalf("Failed to update test execution phase: %v", err)
		}
		return updated
	}

	return created
}

// createUniqueTestWorkflow creates a workflow with a unique ID
func createUniqueTestWorkflow(t *testing.T, s store.Store, suffix string) *workflowv1.Workflow {
	id := fmt.Sprintf("wf-test-workflow-%s-%d", suffix, time.Now().UnixNano())
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: "Test Workflow " + suffix,
			Slug: "test-workflow-" + suffix,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow",
		},
	}

	err := s.SaveResource(contextWithWorkflowKind(), apiresourcekind.ApiResourceKind_workflow, workflow.Metadata.Id, workflow)
	if err != nil {
		t.Fatalf("failed to create test workflow: %v", err)
	}

	return workflow
}

// createUniqueTestWorkflowInstance creates a workflow instance with a unique ID
func createUniqueTestWorkflowInstance(t *testing.T, s store.Store, workflowID string, suffix string) *workflowinstancev1.WorkflowInstance {
	id := fmt.Sprintf("wfi-test-instance-%s-%d", suffix, time.Now().UnixNano())
	instance := &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: "Test Workflow Instance " + suffix,
			Slug: "test-workflow-instance-" + suffix,
			Org:  "test-org",
		},
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId:  workflowID,
			Description: "Test workflow instance",
		},
	}

	err := s.SaveResource(contextWithWorkflowInstanceKind(), apiresourcekind.ApiResourceKind_workflow_instance, instance.Metadata.Id, instance)
	if err != nil {
		t.Fatalf("failed to create test workflow instance: %v", err)
	}

	return instance
}

// Unused but kept for reference
var _ = (*workflowv1.Workflow)(nil)
var _ = (*workflowinstancev1.WorkflowInstance)(nil)

// =============================================================================
// Cancel Handler Tests
// =============================================================================

func TestWorkflowExecutionController_Cancel(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Note: Tests without Temporal client will fail at the CancelTemporalWorkflow step
	// for non-idempotent cases. Idempotent cases (already cancelled) skip Temporal.

	t.Run("cancel idempotency - already CANCELLED", func(t *testing.T) {
		// This test works without Temporal because idempotent case skips Temporal step
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, "cancel-idempotent")

		// Attempt to cancel again
		cancelled, err := controller.Cancel(contextWithWorkflowExecutionKind(), &workflowexecutionv1.CancelWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Second cancellation attempt",
		})
		if err != nil {
			t.Fatalf("Idempotent cancel should succeed, got error: %v", err)
		}

		// Verify phase is still CANCELLED
		if cancelled.Status.Phase != workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
			t.Errorf("Expected phase EXECUTION_CANCELLED, got %v", cancelled.Status.Phase)
		}
	})

	t.Run("cancel COMPLETED execution - should fail", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "cancel-completed")

		// Attempt to cancel - should fail at validation step (before Temporal)
		_, err := controller.Cancel(contextWithWorkflowExecutionKind(), &workflowexecutionv1.CancelWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when cancelling COMPLETED execution")
		}
	})

	t.Run("cancel FAILED execution - should fail", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "cancel-failed")

		// Attempt to cancel - should fail at validation step (before Temporal)
		_, err := controller.Cancel(contextWithWorkflowExecutionKind(), &workflowexecutionv1.CancelWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when cancelling FAILED execution")
		}
	})

	t.Run("cancel TERMINATED execution - should fail", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, "cancel-terminated")

		// Attempt to cancel - should fail at validation step (before Temporal)
		_, err := controller.Cancel(contextWithWorkflowExecutionKind(), &workflowexecutionv1.CancelWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when cancelling TERMINATED execution")
		}
	})

	t.Run("cancel non-existent execution", func(t *testing.T) {
		_, err := controller.Cancel(contextWithWorkflowExecutionKind(), &workflowexecutionv1.CancelWorkflowExecutionInput{
			Id:     "non-existent-id",
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when cancelling non-existent execution")
		}
	})

	t.Run("cancel with empty ID", func(t *testing.T) {
		_, err := controller.Cancel(contextWithWorkflowExecutionKind(), &workflowexecutionv1.CancelWorkflowExecutionInput{
			Id:     "",
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when cancelling with empty ID")
		}
	})
}

// =============================================================================
// Terminate Handler Tests
// =============================================================================

func TestWorkflowExecutionController_Terminate(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Note: Tests without Temporal client will fail at the TerminateTemporalWorkflow step
	// for non-idempotent cases. Idempotent cases (already terminated) skip Temporal.

	t.Run("terminate idempotency - already TERMINATED", func(t *testing.T) {
		// This test works without Temporal because idempotent case skips Temporal step
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, "terminate-idempotent")

		// Attempt to terminate again
		terminated, err := controller.Terminate(contextWithWorkflowExecutionKind(), &workflowexecutionv1.TerminateWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Second termination attempt",
		})
		if err != nil {
			t.Fatalf("Idempotent terminate should succeed, got error: %v", err)
		}

		// Verify phase is still TERMINATED
		if terminated.Status.Phase != workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
			t.Errorf("Expected phase EXECUTION_TERMINATED, got %v", terminated.Status.Phase)
		}
	})

	t.Run("terminate COMPLETED execution - should fail", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "terminate-completed")

		// Attempt to terminate - should fail at validation step (before Temporal)
		_, err := controller.Terminate(contextWithWorkflowExecutionKind(), &workflowexecutionv1.TerminateWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when terminating COMPLETED execution")
		}
	})

	t.Run("terminate CANCELLED execution - should fail", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, "terminate-cancelled")

		// Attempt to terminate - should fail at validation step (before Temporal)
		_, err := controller.Terminate(contextWithWorkflowExecutionKind(), &workflowexecutionv1.TerminateWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when terminating CANCELLED execution")
		}
	})

	t.Run("terminate FAILED execution - should fail", func(t *testing.T) {
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, "terminate-failed")

		// Attempt to terminate - should fail at validation step (before Temporal)
		_, err := controller.Terminate(contextWithWorkflowExecutionKind(), &workflowexecutionv1.TerminateWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when terminating FAILED execution")
		}
	})

	t.Run("terminate non-existent execution", func(t *testing.T) {
		_, err := controller.Terminate(contextWithWorkflowExecutionKind(), &workflowexecutionv1.TerminateWorkflowExecutionInput{
			Id:     "non-existent-id",
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when terminating non-existent execution")
		}
	})

	t.Run("terminate with empty ID", func(t *testing.T) {
		_, err := controller.Terminate(contextWithWorkflowExecutionKind(), &workflowexecutionv1.TerminateWorkflowExecutionInput{
			Id:     "",
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when terminating with empty ID")
		}
	})
}

// =============================================================================
// Recover Handler Tests
// =============================================================================

func TestWorkflowExecutionController_Recover(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Note: Tests without Temporal client will fail at the ResetTemporalWorkflow step
	// for recoverable phases (FAILED). Tests that fail at validation stage work without Temporal.

	t.Run("recover idempotency - already IN_PROGRESS", func(t *testing.T) {
		// This test works without Temporal because idempotent case skips Temporal step
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "recover-idempotent")

		// Attempt to recover - should succeed idempotently
		recovered, err := controller.Recover(contextWithWorkflowExecutionKind(), &workflowexecutionv1.RecoverWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Recovery attempt on already running",
		})
		if err != nil {
			t.Fatalf("Idempotent recover should succeed, got error: %v", err)
		}

		// Verify phase is still IN_PROGRESS
		if recovered.Status.Phase != workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
			t.Errorf("Expected phase EXECUTION_IN_PROGRESS, got %v", recovered.Status.Phase)
		}
	})

	t.Run("recover COMPLETED execution - should fail", func(t *testing.T) {
		// Should fail at validation step (before Temporal)
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, "recover-completed")

		// Attempt to recover
		_, err := controller.Recover(contextWithWorkflowExecutionKind(), &workflowexecutionv1.RecoverWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when recovering COMPLETED execution")
		}
	})

	t.Run("recover CANCELLED execution - should fail", func(t *testing.T) {
		// Should fail at validation step (before Temporal)
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, "recover-cancelled")

		// Attempt to recover
		_, err := controller.Recover(contextWithWorkflowExecutionKind(), &workflowexecutionv1.RecoverWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when recovering CANCELLED execution")
		}
	})

	t.Run("recover TERMINATED execution - should fail", func(t *testing.T) {
		// Should fail at validation step (before Temporal)
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, "recover-terminated")

		// Attempt to recover
		_, err := controller.Recover(contextWithWorkflowExecutionKind(), &workflowexecutionv1.RecoverWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when recovering TERMINATED execution")
		}
	})

	t.Run("recover PENDING execution - should fail", func(t *testing.T) {
		// Should fail at validation step (before Temporal)
		execution := createTestExecutionWithPhaseUnique(t, controller, store, workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING, "recover-pending")

		// Attempt to recover
		_, err := controller.Recover(contextWithWorkflowExecutionKind(), &workflowexecutionv1.RecoverWorkflowExecutionInput{
			Id:     execution.Metadata.Id,
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when recovering PENDING execution")
		}
	})

	t.Run("recover non-existent execution", func(t *testing.T) {
		_, err := controller.Recover(contextWithWorkflowExecutionKind(), &workflowexecutionv1.RecoverWorkflowExecutionInput{
			Id:     "non-existent-id",
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when recovering non-existent execution")
		}
	})

	t.Run("recover with empty ID", func(t *testing.T) {
		_, err := controller.Recover(contextWithWorkflowExecutionKind(), &workflowexecutionv1.RecoverWorkflowExecutionInput{
			Id:     "",
			Reason: "Should fail",
		})
		if err == nil {
			t.Error("Expected error when recovering with empty ID")
		}
	})
}
