//go:build e2e
// +build e2e

package e2e

// TestApplyWorkflowCallingAgentDryRun tests the dry-run mode of apply command for workflow calling agent
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentDryRun() {
	s.T().Logf("=== Testing Workflow-Calling-Agent Dry-Run ===")

	// STEP 1: Execute dry-run
	output := ApplyWorkflowCallingAgentDryRun(s.T(), s.Harness.ServerPort)

	// STEP 2: Verify dry-run output
	VerifyWorkflowCallingAgentDryRunOutput(s.T(), output)

	// STEP 3: Summary
	s.T().Logf("✅ Dry-run test passed: Dry-run successful (no resources deployed)")
}
