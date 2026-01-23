//go:build e2e
// +build e2e

package e2e

// TestApplyBasicWorkflow tests the full workflow apply workflow:
// 1. Server is running with isolated storage
// 2. Apply command deploys workflow from code (from SDK example 07_basic_workflow.go)
// 3. Workflow is stored in BadgerDB
// 4. Can retrieve and verify workflow data
//
// The SDK example creates ONE workflow:
// - basic-data-fetch: Workflow with HTTP GET and SET tasks
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
//
// This test validates the COMPLETE workflow lifecycle including default instance creation.
func (s *E2ESuite) TestApplyBasicWorkflow() {
	s.T().Logf("=== Testing Basic Workflow Apply (from SDK example 07_basic_workflow.go) ===")

	// STEP 1: Apply workflow from SDK example
	result := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)

	// STEP 2: Verify CLI output
	VerifyApplyOutputSuccess(s.T(), result.Output)

	// STEP 3: Verify basic workflow properties
	VerifyWorkflowBasicProperties(s.T(), result.Workflow)

	// STEP 4: Verify workflow tasks
	VerifyWorkflowTasks(s.T(), result.Workflow)

	// STEP 5: Verify environment variables
	VerifyWorkflowEnvironmentVariables(s.T(), result.Workflow)

	// STEP 6: Verify default workflow instance was auto-created
	VerifyWorkflowDefaultInstance(s.T(), s.Harness.ServerPort, result.Workflow)

	// Summary
	s.T().Logf("✅ Test passed: Workflow and its default instance were successfully created")
	s.T().Logf("   Workflow ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("   Default Instance ID: %s", result.Workflow.Status.DefaultInstanceId)
	s.T().Logf("   Namespace: %s", result.Workflow.Spec.Document.Namespace)
	s.T().Logf("   Version: %s", result.Workflow.Spec.Document.Version)
	s.T().Logf("   Task count: %d", len(result.Workflow.Spec.Tasks))
}
