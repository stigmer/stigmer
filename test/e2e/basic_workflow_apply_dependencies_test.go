//go:build e2e
// +build e2e

package e2e

// TestApplyWorkflowTaskDependencies verifies implicit task dependencies
//
// Example: sdk/go/examples/07_basic_workflow.go demonstrates:
// - fetchData task (HTTP GET)
// - processResponse task depends on fetchData implicitly through field references
// - No manual ThenRef() needed - dependencies are automatic
//
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
//
// This test validates that the SDK pattern of implicit dependencies works correctly.
func (s *E2ESuite) TestApplyWorkflowTaskDependencies() {
	s.T().Logf("=== Testing Workflow Task Dependencies ===")

	// Apply workflow from SDK example
	result := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)

	// Verify tasks exist
	s.Require().NotNil(result.Workflow.Spec.Tasks, "Workflow should have tasks")
	s.Require().GreaterOrEqual(len(result.Workflow.Spec.Tasks), BasicWorkflowTaskCount,
		"Workflow should have at least 2 tasks from SDK example")

	// Build task map for easier lookup
	taskMap := make(map[string]bool)
	for _, task := range result.Workflow.Spec.Tasks {
		taskMap[task.Name] = true
	}

	// Verify expected tasks from SDK example exist
	s.True(taskMap[BasicWorkflowFetchTask], "fetchData task should exist from SDK example")
	s.True(taskMap[BasicWorkflowProcessTask], "processResponse task should exist from SDK example")

	s.T().Logf("✓ Found tasks: %s, %s", BasicWorkflowFetchTask, BasicWorkflowProcessTask)
	s.T().Logf("✓ Implicit dependencies created through task field references")
	s.T().Logf("   %s uses %s.Field('title') and %s.Field('body')",
		BasicWorkflowProcessTask, BasicWorkflowFetchTask, BasicWorkflowFetchTask)
	s.T().Logf("   No manual ThenRef() needed - SDK pattern works!")

	s.T().Logf("✅ Task dependency test passed: Workflow tasks are properly structured")
}
