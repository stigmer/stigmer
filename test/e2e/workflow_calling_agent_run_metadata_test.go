//go:build e2e
// +build e2e

package e2e

import (
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunWorkflowCallingAgentVerifyMetadata tests that execution metadata is properly set
// and execution completes successfully
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
//
// This test validates execution metadata integrity.
func (s *E2ESuite) TestRunWorkflowCallingAgentVerifyMetadata() {
	s.T().Logf("=== Testing Workflow Execution Metadata ===")

	// STEP 1: Apply workflow and agent
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow deployed with ID: %s", result.Workflow.Metadata.Id)

	// STEP 2: Run workflow
	s.T().Logf("Step 2: Running workflow...")
	runResult := RunWorkflowByName(s.T(), s.Harness.ServerPort, WorkflowCallingWorkflowName)
	s.T().Logf("✓ Execution created: %s", runResult.ExecutionID)

	// STEP 3: Verify initial execution metadata via API
	initialExecution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should be able to query execution via API")
	s.Require().NotNil(initialExecution, "Execution should exist")

	// Verify metadata fields
	s.NotNil(initialExecution.Metadata, "Execution should have metadata")
	s.Equal(runResult.ExecutionID, initialExecution.Metadata.Id, "Execution ID should match")
	s.NotEmpty(initialExecution.Metadata.Id, "Execution should have an ID")

	// Verify execution references the correct workflow
	s.NotNil(initialExecution.Spec, "Execution should have spec")
	s.Equal(result.Workflow.Metadata.Id, initialExecution.Spec.WorkflowId,
		"Execution should reference the workflow")

	// Verify execution status
	s.NotNil(initialExecution.Status, "Execution should have status")
	s.T().Logf("✓ Initial execution phase: %s", initialExecution.Status.Phase.String())

	// STEP 4: Wait for execution to complete
	s.T().Logf("Step 3: Waiting for execution to complete (timeout: 30s)...")
	completedExecution, err := WaitForWorkflowExecutionPhase(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)

	// Check if execution completed successfully
	if err != nil {
		currentExecution, getErr := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
		if getErr != nil {
			s.T().Fatalf("❌ Execution failed and couldn't retrieve status: %v (original error: %v)", getErr, err)
		}

		s.T().Logf("❌ Execution metadata test failed")
		s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
		s.T().Logf("   Current Phase: %s", currentExecution.Status.Phase.String())
		if currentExecution.Status.Error != "" {
			s.T().Logf("   Error Message: %s", currentExecution.Status.Error)
		}

		s.Require().NoError(err, "Workflow execution should complete successfully")
	}

	s.Require().NotNil(completedExecution, "Completed execution should not be nil")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, completedExecution.Status.Phase,
		"Execution should be in COMPLETED phase")

	s.T().Logf("✅ Metadata Verification Test Passed!")
	s.T().Logf("   Workflow ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", completedExecution.Metadata.Id)
	s.T().Logf("   Execution references workflow: %s", completedExecution.Spec.WorkflowId)
	s.T().Logf("   Final execution phase: %s", completedExecution.Status.Phase.String())
}
