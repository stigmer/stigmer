//go:build e2e
// +build e2e

package e2e

import (
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunWorkflowCallingAgentVerifyPhase tests workflow execution phase progression
// using STREAMING RPC. Verifies execution starts in PENDING and progresses to COMPLETED.
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
//
// This test validates the phase state machine progression.
func (s *E2ESuite) TestRunWorkflowCallingAgentVerifyPhase() {
	s.T().Logf("=== Testing Workflow Execution Phase Progression ===")

	// STEP 1: Apply workflow and agent
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow deployed with ID: %s", result.Workflow.Metadata.Id)

	// STEP 2: Run workflow
	s.T().Logf("Step 2: Running workflow...")
	runResult := RunWorkflowByName(s.T(), s.Harness.ServerPort, WorkflowCallingWorkflowName)
	s.T().Logf("✓ Execution created with ID: %s", runResult.ExecutionID)

	// STEP 3: Verify execution starts in PENDING phase
	initialExecution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should be able to query execution via API")
	s.Require().NotNil(initialExecution, "Execution should exist")
	s.T().Logf("✓ Initial execution phase: %s", initialExecution.Status.Phase.String())

	// STEP 4: Subscribe to execution stream and wait for completion
	s.T().Logf("Step 3: Subscribing to execution stream (timeout: 30s)...")
	completedExecution, err := WaitForWorkflowExecutionPhaseViaStream(
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

		s.T().Logf("❌ Execution phase progression failed")
		s.T().Logf("   Initial Phase: %s", initialExecution.Status.Phase.String())
		s.T().Logf("   Current Phase: %s", currentExecution.Status.Phase.String())
		if currentExecution.Status.Error != "" {
			s.T().Logf("   Error Message: %s", currentExecution.Status.Error)
		}

		s.Require().NoError(err, "Workflow execution should complete successfully")
	}

	s.Require().NotNil(completedExecution, "Completed execution should not be nil")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, completedExecution.Status.Phase,
		"Execution should be in COMPLETED phase")

	s.T().Logf("✅ Execution Phase Test Passed (via streaming)!")
	s.T().Logf("   Workflow ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Initial Phase: %s", initialExecution.Status.Phase.String())
	s.T().Logf("   Final Phase: %s", completedExecution.Status.Phase.String())
}
