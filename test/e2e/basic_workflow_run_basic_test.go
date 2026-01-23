//go:build e2e
// +build e2e

package e2e

// TestRunBasicWorkflow tests the complete workflow execution workflow using STREAMING RPC:
// 1. Apply a basic workflow (from SDK example 07_basic_workflow.go)
// 2. Execute 'stigmer run' command
// 3. Subscribe to execution stream for real-time updates
// 4. Verify execution completed successfully
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
func (s *E2ESuite) TestRunBasicWorkflow() {
	s.T().Logf("=== Testing Basic Workflow Run (from SDK example 07_basic_workflow.go) ===")

	// STEP 1: Apply workflow from SDK example
	s.T().Logf("Step 1: Applying workflow...")
	applyResult := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow deployed with ID: %s", applyResult.Workflow.Metadata.Id)

	// STEP 2: Run the basic workflow by name
	s.T().Logf("Step 2: Running workflow and creating execution...")
	runResult := RunWorkflowByName(s.T(), s.Harness.ServerPort, BasicWorkflowName)

	// STEP 3: Verify run command output
	VerifyWorkflowRunOutputSuccess(s.T(), runResult.Output, BasicWorkflowName)

	// STEP 4: Subscribe to execution stream and wait for completion
	s.T().Logf("Step 3: Subscribing to execution stream...")
	execution := WaitForWorkflowExecutionCompletionViaStream(
		s.T(),
		s.Harness.ServerPort,
		runResult.ExecutionID,
		WorkflowExecutionTimeoutSeconds,
	)

	// STEP 5: Verify execution completed successfully
	s.T().Logf("Step 4: Verifying execution completed successfully...")
	VerifyWorkflowExecutionCompleted(s.T(), execution)

	// STEP 6: Summary
	s.T().Logf("✅ Test Passed (via streaming)!")
	s.T().Logf("   Workflow ID: %s", applyResult.Workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Final phase: %s", execution.Status.Phase)
}
