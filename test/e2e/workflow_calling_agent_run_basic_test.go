//go:build e2e
// +build e2e

package e2e

import (
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunWorkflowCallingAgent tests the core run command workflow using STREAMING RPC:
// 1. Apply a workflow that calls an agent (from SDK example 15_workflow_calling_simple_agent.go)
// 2. Execute 'stigmer run' command for the workflow
// 3. Verify execution record is created
// 4. Subscribe to execution stream for real-time updates
// 5. Verify execution reached a terminal state without errors
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
//
// This test validates the COMPLETE workflow run lifecycle.
func (s *E2ESuite) TestRunWorkflowCallingAgent() {
	s.T().Logf("=== Testing Workflow Run (from SDK example 15_workflow_calling_simple_agent.go) ===")

	// STEP 1: Apply workflow and agent from SDK example
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow deployed with ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("✓ Agent deployed with ID: %s", result.Agent.Metadata.Id)

	// STEP 2: Run the workflow by name
	s.T().Logf("Step 2: Running workflow...")
	runResult := RunWorkflowByName(s.T(), s.Harness.ServerPort, WorkflowCallingWorkflowName)

	// STEP 3: Verify execution was created
	VerifyWorkflowRunOutputSuccess(s.T(), runResult.Output, WorkflowCallingWorkflowName)
	s.T().Logf("✓ Execution created with ID: %s", runResult.ExecutionID)

	// STEP 4: Verify execution exists via API
	s.T().Logf("Step 3: Verifying execution exists via API...")
	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should be able to query execution via API")
	s.Require().NotNil(execution, "Execution should exist")

	// STEP 5: Subscribe to execution stream and wait for completion
	s.T().Logf("Step 4: Subscribing to execution stream (timeout: 30s)...")
	completedExecution, err := WaitForWorkflowExecutionPhaseViaStream(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)

	// Check if execution completed successfully
	if err != nil {
		s.handleExecutionFailure(runResult.ExecutionID, err)
	}

	s.Require().NotNil(completedExecution, "Completed execution should not be nil")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, completedExecution.Status.Phase,
		"Execution should be in COMPLETED phase")

	s.T().Logf("✅ Test Passed (via streaming)!")
	s.T().Logf("   Agent ID: %s", result.Agent.Metadata.Id)
	s.T().Logf("   Workflow ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Execution completed successfully")
}

// handleExecutionFailure is a helper to provide detailed error reporting
func (s *E2ESuite) handleExecutionFailure(executionID string, err error) {
	currentExecution, getErr := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
	if getErr != nil {
		s.T().Fatalf("❌ Execution failed and couldn't retrieve status: %v (original error: %v)", getErr, err)
	}

	s.T().Logf("❌ Execution did not complete successfully")
	s.T().Logf("   Current Phase: %s", currentExecution.Status.Phase.String())
	if currentExecution.Status.Error != "" {
		s.T().Logf("   Error Message: %s", currentExecution.Status.Error)
	}

	s.Require().NoError(err, "Workflow execution should complete successfully")
}
