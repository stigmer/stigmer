//go:build e2e
// +build e2e

package e2e

// TestRunWorkflowCallingAgentWithInvalidName tests error handling when running non-existent workflow
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
//
// This test validates that the run command properly handles invalid workflow names.
func (s *E2ESuite) TestRunWorkflowCallingAgentWithInvalidName() {
	s.T().Logf("=== Testing Error Handling for Invalid Workflow Name ===")

	// Try to run a workflow that doesn't exist
	s.T().Logf("Testing error handling for invalid workflow name...")

	_, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "non-existent-workflow",
		"--follow=false",
	)

	// Should fail with error
	s.Error(err, "Run command should fail for non-existent workflow")

	s.T().Logf("✅ Error Handling Test Passed!")
	s.T().Logf("   Correctly rejected invalid workflow name")
}
