package root

import (
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// =============================================================================
// displayAgentPhaseChange Tests
// =============================================================================

func TestDisplayAgentPhaseChange_WaitingForApproval(t *testing.T) {
	// This test verifies that the function handles the WAITING_FOR_APPROVAL phase
	// without panicking. The actual colored output from cliprint goes through
	// fatih/color which writes directly, so we just verify no panic occurs.
	// The function's behavior is verified through visual inspection and integration tests.
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("displayAgentPhaseChange panicked: %v", r)
		}
	}()

	displayAgentPhaseChange(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
}

func TestDisplayAgentPhaseChange_AllPhases(t *testing.T) {
	// Test that all phase values are handled without panic
	phases := []agentexecutionv1.ExecutionPhase{
		agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
	}

	for _, phase := range phases {
		t.Run(phase.String(), func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("displayAgentPhaseChange(%v) panicked: %v", phase, r)
				}
			}()

			displayAgentPhaseChange(phase)
		})
	}
}

// =============================================================================
// displayWorkflowTask Tests
// =============================================================================

func TestDisplayWorkflowTask_WaitingApproval(t *testing.T) {
	task := &workflowexecutionv1.WorkflowTask{
		TaskName: "invoke-agent",
		Status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL,
	}

	output := captureStdout(t, func() {
		displayWorkflowTask(task)
	})

	// Verify the waiting approval status is displayed
	if !strings.Contains(output, "Awaiting Approval") {
		t.Errorf("expected output to contain 'Awaiting Approval', got: %s", output)
	}

	// Verify task name is displayed
	if !strings.Contains(output, "invoke-agent") {
		t.Errorf("expected output to contain task name 'invoke-agent', got: %s", output)
	}

	// Verify icon is displayed (pause symbol)
	if !strings.Contains(output, "⏸") {
		t.Errorf("expected output to contain pause icon '⏸', got: %s", output)
	}
}

func TestDisplayWorkflowTask_AllStatuses(t *testing.T) {
	tests := []struct {
		name     string
		status   workflowexecutionv1.WorkflowTaskStatus
		contains string
	}{
		{
			name:     "pending",
			status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_PENDING,
			contains: "Pending",
		},
		{
			name:     "in_progress",
			status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS,
			contains: "Running",
		},
		{
			name:     "completed",
			status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			contains: "Completed",
		},
		{
			name:     "failed",
			status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED,
			contains: "Failed",
		},
		{
			name:     "skipped",
			status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED,
			contains: "Skipped",
		},
		{
			name:     "waiting_approval",
			status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL,
			contains: "Awaiting Approval",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task := &workflowexecutionv1.WorkflowTask{
				TaskName: "test-task",
				Status:   tt.status,
			}

			output := captureStdout(t, func() {
				displayWorkflowTask(task)
			})

			if !strings.Contains(output, tt.contains) {
				t.Errorf("expected output to contain '%s', got: %s", tt.contains, output)
			}
		})
	}
}

func TestDisplayWorkflowTask_WithError(t *testing.T) {
	task := &workflowexecutionv1.WorkflowTask{
		TaskName: "failing-task",
		Status:   workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED,
		Error:    "connection timeout",
	}

	output := captureStdout(t, func() {
		displayWorkflowTask(task)
	})

	// Verify error is displayed
	if !strings.Contains(output, "connection timeout") {
		t.Errorf("expected output to contain error message, got: %s", output)
	}
}

// =============================================================================
// isTerminalAgentPhase Tests
// =============================================================================

func TestIsTerminalAgentPhase(t *testing.T) {
	tests := []struct {
		name     string
		phase    agentexecutionv1.ExecutionPhase
		expected bool
	}{
		{
			name:     "pending is not terminal",
			phase:    agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
			expected: false,
		},
		{
			name:     "in_progress is not terminal",
			phase:    agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			expected: false,
		},
		{
			name:     "waiting_for_approval is not terminal",
			phase:    agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			expected: false,
		},
		{
			name:     "completed is terminal",
			phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			expected: true,
		},
		{
			name:     "failed is terminal",
			phase:    agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			expected: true,
		},
		{
			name:     "cancelled is terminal",
			phase:    agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isTerminalAgentPhase(tt.phase)
			if result != tt.expected {
				t.Errorf("isTerminalAgentPhase(%v) = %v, want %v", tt.phase, result, tt.expected)
			}
		})
	}
}

// =============================================================================
// isTerminalWorkflowPhase Tests
// =============================================================================

func TestIsTerminalWorkflowPhase(t *testing.T) {
	tests := []struct {
		name     string
		phase    workflowexecutionv1.ExecutionPhase
		expected bool
	}{
		{
			name:     "pending is not terminal",
			phase:    workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING,
			expected: false,
		},
		{
			name:     "in_progress is not terminal",
			phase:    workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			expected: false,
		},
		{
			name:     "completed is terminal",
			phase:    workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			expected: true,
		},
		{
			name:     "failed is terminal",
			phase:    workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			expected: true,
		},
		{
			name:     "cancelled is terminal",
			phase:    workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isTerminalWorkflowPhase(tt.phase)
			if result != tt.expected {
				t.Errorf("isTerminalWorkflowPhase(%v) = %v, want %v", tt.phase, result, tt.expected)
			}
		})
	}
}
