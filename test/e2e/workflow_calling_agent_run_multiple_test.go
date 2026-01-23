//go:build e2e
// +build e2e

package e2e

import (
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunWorkflowCallingAgentMultipleTimes tests running the same workflow multiple times
// using STREAMING RPC. This verifies that multiple executions can be created and completed
// for the same workflow.
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
//
// This test validates concurrent execution capability.
func (s *E2ESuite) TestRunWorkflowCallingAgentMultipleTimes() {
	s.T().Logf("=== Testing Multiple Workflow Executions ===")

	// STEP 1: Apply workflow and agent
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow deployed with ID: %s", result.Workflow.Metadata.Id)

	// STEP 2: Run workflow first time
	s.T().Logf("Step 2: Running workflow first time...")
	runResult1 := RunWorkflowByName(s.T(), s.Harness.ServerPort, WorkflowCallingWorkflowName)
	s.T().Logf("✓ First execution created: %s", runResult1.ExecutionID)

	// STEP 3: Run workflow second time
	s.T().Logf("Step 3: Running workflow second time...")
	runResult2 := RunWorkflowByName(s.T(), s.Harness.ServerPort, WorkflowCallingWorkflowName)
	s.T().Logf("✓ Second execution created: %s", runResult2.ExecutionID)

	// STEP 4: Verify both executions are different
	s.NotEqual(runResult1.ExecutionID, runResult2.ExecutionID,
		"Each run should create a unique execution ID")

	// STEP 5: Subscribe to both execution streams and wait for completion
	s.T().Logf("Step 4: Subscribing to both execution streams...")

	execution1, err := WaitForWorkflowExecutionPhaseViaStream(
		s.Harness.ServerPort,
		runResult1.ExecutionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)
	if err != nil {
		s.logExecutionFailure(runResult1.ExecutionID, "First")
		s.Require().NoError(err, "First execution should complete successfully")
	}
	s.T().Logf("✓ First execution completed: %s", runResult1.ExecutionID)

	execution2, err := WaitForWorkflowExecutionPhaseViaStream(
		s.Harness.ServerPort,
		runResult2.ExecutionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)
	if err != nil {
		s.logExecutionFailure(runResult2.ExecutionID, "Second")
		s.Require().NoError(err, "Second execution should complete successfully")
	}
	s.T().Logf("✓ Second execution completed: %s", runResult2.ExecutionID)

	// Verify both are in COMPLETED phase
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution1.Status.Phase)
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution2.Status.Phase)

	s.T().Logf("✅ Multiple Execution Test Passed (via streaming)!")
	s.T().Logf("   Workflow ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("   First Execution ID: %s (Phase: %s)", runResult1.ExecutionID, execution1.Status.Phase.String())
	s.T().Logf("   Second Execution ID: %s (Phase: %s)", runResult2.ExecutionID, execution2.Status.Phase.String())
	s.T().Logf("   Both executions completed successfully with unique IDs")
}

// logExecutionFailure is a helper to log execution failure details
func (s *E2ESuite) logExecutionFailure(executionID string, label string) {
	currentExec, _ := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
	if currentExec != nil {
		s.T().Logf("❌ %s execution failed - Phase: %s, Error: %s",
			label, currentExec.Status.Phase.String(), currentExec.Status.Error)
	}
}
