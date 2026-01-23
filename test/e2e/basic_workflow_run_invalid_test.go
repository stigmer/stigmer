//go:build e2e
// +build e2e

package e2e

// TestRunWorkflowWithInvalidName tests error handling when running non-existent workflow
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
func (s *E2ESuite) TestRunWorkflowWithInvalidName() {
	s.T().Logf("=== Testing Error Handling for Invalid Workflow Name ===")

	// Try to run a workflow that doesn't exist
	s.T().Logf("Attempting to run non-existent workflow...")

	_, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "non-existent-workflow",
	)

	// Should fail with error
	s.Error(err, "Run command should fail for non-existent workflow")

	s.T().Logf("✅ Error Handling Test Passed!")
	s.T().Logf("   Correctly rejected invalid workflow name")
}
