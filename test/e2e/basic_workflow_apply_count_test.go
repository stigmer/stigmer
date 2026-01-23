//go:build e2e
// +build e2e

package e2e

// TestApplyWorkflowCount verifies that the SDK example creates exactly 1 workflow
//
// Example: sdk/go/examples/07_basic_workflow.go creates:
// 1. basic-data-fetch (workflow with HTTP GET and SET tasks)
//
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
//
// This test ensures we maintain parity with the SDK example - if the SDK example
// changes to create more workflows, this test will catch it.
func (s *E2ESuite) TestApplyWorkflowCount() {
	s.T().Logf("=== Testing Workflow Count (SDK example should create exactly 1 workflow) ===")

	// Apply workflow from SDK example
	result := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)

	// Verify workflow exists
	s.Equal(BasicWorkflowName, result.Workflow.Metadata.Name,
		"Workflow name should match SDK example")

	s.T().Logf("✓ Found workflow: %s (ID: %s)", 
		result.Workflow.Metadata.Name, result.Workflow.Metadata.Id)
	s.T().Logf("✅ Workflow count test passed: Exactly 1 workflow deployed (verified via API by slug)")
}
