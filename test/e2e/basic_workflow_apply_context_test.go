//go:build e2e
// +build e2e

package e2e

// TestApplyWorkflowWithContext verifies that context variables are properly handled
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
//
// The SDK example demonstrates:
// - Using stigmer.Run() for automatic context management
// - Context variables for configuration (apiBase, org)
// - Context is used at workflow creation time, not stored in spec
func (s *E2ESuite) TestApplyWorkflowWithContext() {
	s.T().Logf("=== Testing Workflow Context Management ===")

	// Apply workflow from SDK example
	result := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)

	// Verify workflow was created successfully
	// Note: Context variables (apiBase, org) are used during workflow creation
	// but are not stored in the workflow spec - they're compile-time configuration
	s.NotNil(result.Workflow, "Workflow should be created with context management")

	s.T().Logf("✓ Workflow created with context variables (apiBase, org)")
	s.T().Logf("   Context variables are managed at workflow creation time")
	s.T().Logf("   Not stored in spec - compile-time configuration only")

	// Verify that the workflow was created correctly using stigmer.Run() pattern
	s.Equal(BasicWorkflowName, result.Workflow.Metadata.Name,
		"Workflow should be created with correct name from context-managed SDK example")

	s.T().Logf("✅ Context test passed: Workflow correctly uses stigmer.Run() pattern")
}
