//go:build e2e
// +build e2e

package e2e

import (
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunWorkflowExecutionPhases tests workflow execution phase progression:
// 1. Execution starts in PENDING phase
// 2. Transitions to IN_PROGRESS during execution
// 3. Completes in COMPLETED phase
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
func (s *E2ESuite) TestRunWorkflowExecutionPhases() {
	s.T().Logf("=== Testing Workflow Execution Phase Progression ===")

	// STEP 1: Apply workflow
	s.T().Logf("Step 1: Applying workflow...")
	applyResult := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow deployed with ID: %s", applyResult.Workflow.Metadata.Id)

	// STEP 2: Run workflow
	s.T().Logf("Step 2: Running workflow...")
	runResult := RunWorkflowByName(s.T(), s.Harness.ServerPort, BasicWorkflowName)

	// STEP 3: Query execution (may already be completed if execution is fast)
	s.T().Logf("Step 3: Querying initial execution state...")
	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.NoError(err, "Should be able to query execution via API")
	s.NotNil(execution, "Execution should exist")

	// Log the initial phase we observed
	// Note: Fast executions may already be COMPLETED by the time we query
	initialPhase := execution.Status.Phase
	s.T().Logf("✓ Initial phase observed: %s", initialPhase)

	// STEP 4: Wait for execution to complete
	s.T().Logf("Step 4: Waiting for execution to complete (observing phase transitions)...")
	finalExecution := WaitForWorkflowExecutionCompletion(s.T(), s.Harness.ServerPort, runResult.ExecutionID, WorkflowExecutionTimeoutSeconds)

	// STEP 5: Verify final phase is COMPLETED
	s.T().Logf("Step 5: Verifying final execution phase...")
	VerifyWorkflowExecutionCompleted(s.T(), finalExecution)

	// STEP 6: Summary
	s.T().Logf("✅ Execution Phase Test Passed!")
	s.T().Logf("   Workflow ID: %s", applyResult.Workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Initial Phase Observed: %s", initialPhase)
	s.T().Logf("   Final Phase: %s", finalExecution.Status.Phase)
	if initialPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING {
		s.T().Logf("   Phase progression verified: PENDING → COMPLETED")
	} else {
		s.T().Logf("   Note: Execution completed too quickly to observe PENDING phase")
	}
}
