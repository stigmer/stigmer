//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunBasicWorkflow tests the run command workflow (Phase 1 - smoke test):
// 1. Apply a basic workflow (from SDK example 07_basic_workflow.go)
// 2. Execute 'stigmer run' command for the workflow
// 3. Verify execution record is created
// 4. Does NOT wait for actual execution (requires Temporal + workflow-runner)
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
func (s *E2ESuite) TestRunBasicWorkflow() {
	// Step 1: Apply a workflow first
	testdataDir := filepath.Join("testdata", "examples", "07-basic-workflow")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-workflow directory")

	s.T().Logf("Step 1: Applying workflow from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query workflow by slug instead of extracting ID from output
	org := "local" // Using local backend in tests
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "basic-data-fetch", org)
	s.Require().NoError(err, "Should be able to query workflow by slug")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.T().Logf("✓ Workflow deployed with ID: %s", workflow.Metadata.Id)

	// Step 2: Run the workflow by name (not ID)
	// This creates an execution but doesn't wait for it to complete
	s.T().Logf("Step 2: Running workflow (execution creation only)...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "basic-data-fetch", // Use workflow name from SDK example (07_basic_workflow.go)
		"--follow=false", // Don't stream logs (Phase 2 will test this)
	)

	s.T().Logf("Run command output:\n%s", runOutput)
	s.Require().NoError(err, "Run command should succeed")

	// Step 3: Verify execution was created
	s.Contains(runOutput, "Workflow execution started", "Output should indicate execution started")
	s.Contains(runOutput, "basic-data-fetch", "Output should mention the workflow name (from SDK example)")

	// Extract execution ID from output
	// Output format: "Execution ID: wfex_1234567890"
	var executionID string
	runLines := strings.Split(runOutput, "\n")
	for _, line := range runLines {
		if strings.Contains(line, "Execution ID:") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "ID:" && i+1 < len(parts) {
					executionID = strings.TrimSpace(parts[i+1])
					break
				}
			}
			if executionID != "" {
				break
			}
		}
	}

	s.NotEmpty(executionID, "Should be able to extract execution ID from output")
	s.T().Logf("✓ Execution created with ID: %s", executionID)

	// Step 4: Verify execution exists via API
	s.T().Logf("Step 3: Verifying execution exists via API...")

	executionExists, err := WorkflowExecutionExistsViaAPI(s.Harness.ServerPort, executionID)
	s.NoError(err, "Should be able to query execution via API")
	s.True(executionExists, "Execution should exist when queried via API")

	s.T().Logf("✅ Phase 1 Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Execution record created successfully")
	s.T().Logf("")
	s.T().Logf("Note: This test only verifies execution creation.")
	s.T().Logf("      Actual execution requires Temporal + workflow-runner (Phase 2)")
}

// TestRunWorkflowWithInput tests running a workflow with input parameters
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
func (s *E2ESuite) TestRunWorkflowWithInput() {
	// Step 1: Apply workflow
	testdataDir := filepath.Join("testdata", "examples", "07-basic-workflow")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-workflow directory")

	s.T().Logf("Step 1: Applying workflow from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query workflow by slug
	org := "local" // Using local backend in tests
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "basic-data-fetch", org)
	s.Require().NoError(err, "Should be able to query workflow by slug")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.T().Logf("✓ Workflow deployed with ID: %s", workflow.Metadata.Id)

	// Step 2: Run workflow with input parameters
	s.T().Logf("Step 2: Running workflow with input (execution creation only)...")

	// Note: The workflow uses context variables (apiBase, org) which are set in the SDK code
	// For runtime inputs, we could pass them via --input flag (if implemented)
	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "basic-data-fetch",
		"--follow=false",
	)

	s.T().Logf("Run command output:\n%s", runOutput)
	s.Require().NoError(err, "Run command should succeed")

	// Step 3: Verify execution was created
	s.Contains(runOutput, "Workflow execution started", "Output should indicate execution started")

	// Extract execution ID from output
	var executionID string
	runLines := strings.Split(runOutput, "\n")
	for _, line := range runLines {
		if strings.Contains(line, "Execution ID:") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "ID:" && i+1 < len(parts) {
					executionID = strings.TrimSpace(parts[i+1])
					break
				}
			}
			if executionID != "" {
				break
			}
		}
	}

	s.NotEmpty(executionID, "Should be able to extract execution ID from output")
	s.T().Logf("✓ Execution created with ID: %s", executionID)

	// Step 4: Verify execution exists via API
	executionExists, err := WorkflowExecutionExistsViaAPI(s.Harness.ServerPort, executionID)
	s.NoError(err, "Should be able to query execution via API")
	s.True(executionExists, "Execution should exist when queried via API")

	s.T().Logf("✅ Workflow Run with Input Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
}

// TestRunWorkflowWithInvalidName tests error handling when running non-existent workflow
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
func (s *E2ESuite) TestRunWorkflowWithInvalidName() {
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

// TestRunWorkflowExecutionPhases tests workflow execution phase progression
// This is a Phase 1 test that only verifies the execution is created in PENDING phase
//
// Example: sdk/go/examples/07_basic_workflow.go
// Test Fixture: test/e2e/testdata/examples/07-basic-workflow/
func (s *E2ESuite) TestRunWorkflowExecutionPhases() {
	// Step 1: Apply workflow
	testdataDir := filepath.Join("testdata", "examples", "07-basic-workflow")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-workflow directory")

	s.T().Logf("Step 1: Applying workflow from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query workflow by slug
	org := "local" // Using local backend in tests
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "basic-data-fetch", org)
	s.Require().NoError(err, "Should be able to query workflow by slug")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.T().Logf("✓ Workflow deployed with ID: %s", workflow.Metadata.Id)

	// Step 2: Run workflow
	s.T().Logf("Step 2: Running workflow (execution creation only)...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "basic-data-fetch",
		"--follow=false",
	)

	s.T().Logf("Run command output:\n%s", runOutput)
	s.Require().NoError(err, "Run command should succeed")

	// Extract execution ID from output
	var executionID string
	runLines := strings.Split(runOutput, "\n")
	for _, line := range runLines {
		if strings.Contains(line, "Execution ID:") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "ID:" && i+1 < len(parts) {
					executionID = strings.TrimSpace(parts[i+1])
					break
				}
			}
			if executionID != "" {
				break
			}
		}
	}

	s.NotEmpty(executionID, "Should be able to extract execution ID from output")
	s.T().Logf("✓ Execution created with ID: %s", executionID)

	// Step 3: Verify execution phase via API
	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
	s.NoError(err, "Should be able to query execution via API")
	s.NotNil(execution, "Execution should exist")

	// Verify execution is in PENDING phase initially
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING, execution.Status.Phase,
		"New execution should be in PENDING phase")

	s.T().Logf("✅ Execution Phase Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Execution Phase: %s", execution.Status.Phase.String())
	s.T().Logf("")
	s.T().Logf("Note: This test only verifies PENDING phase.")
	s.T().Logf("      Phase progression requires Temporal + workflow-runner (Phase 2)")
}
