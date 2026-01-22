//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunWorkflowCallingAgent tests the run command workflow (Phase 1 - smoke test):
// 1. Apply a workflow that calls an agent (from SDK example 15_workflow_calling_simple_agent.go)
// 2. Execute 'stigmer run' command for the workflow
// 3. Verify execution record is created
// 4. Does NOT wait for actual execution (requires Temporal + workflow-runner)
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestRunWorkflowCallingAgent() {
	// Step 1: Apply workflow and agent first
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	s.T().Logf("Step 1: Applying workflow and agent from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query workflow by slug instead of extracting ID from output
	org := "local" // Using local backend in tests
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query workflow by slug")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.T().Logf("✓ Workflow deployed with ID: %s", workflow.Metadata.Id)

	// Also verify agent exists
	agent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	s.Require().NoError(err, "Should be able to query agent by slug")
	s.Require().NotNil(agent, "Agent should exist")
	s.T().Logf("✓ Agent deployed with ID: %s", agent.Metadata.Id)

	// Step 2: Run the workflow by name (not ID)
	// This creates an execution but doesn't wait for it to complete
	s.T().Logf("Step 2: Running workflow (execution creation only)...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "simple-review", // Use workflow name from SDK example
		"--follow=false", // Don't stream logs (Phase 2 will test this)
	)

	s.T().Logf("Run command output:\n%s", runOutput)
	s.Require().NoError(err, "Run command should succeed")

	// Step 3: Verify execution was created
	s.Contains(runOutput, "Workflow execution started", "Output should indicate execution started")
	s.Contains(runOutput, "simple-review", "Output should mention the workflow name (from SDK example)")

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
	s.T().Logf("   Agent ID: %s", agent.Metadata.Id)
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Execution record created successfully")
	s.T().Logf("")
	s.T().Logf("Note: This test only verifies execution creation.")
	s.T().Logf("      Actual execution requires Temporal + workflow-runner + agent-runner (Phase 2)")
}

// TestRunWorkflowCallingAgentVerifyPhase tests workflow execution phase for agent-calling workflow
// This is a Phase 1 test that only verifies the execution is created in PENDING phase
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestRunWorkflowCallingAgentVerifyPhase() {
	// Step 1: Apply workflow and agent
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	s.T().Logf("Step 1: Applying workflow and agent from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query workflow by slug
	org := "local" // Using local backend in tests
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query workflow by slug")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.T().Logf("✓ Workflow deployed with ID: %s", workflow.Metadata.Id)

	// Step 2: Run workflow
	s.T().Logf("Step 2: Running workflow (execution creation only)...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "simple-review",
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

// TestRunWorkflowCallingAgentWithInvalidName tests error handling when running non-existent workflow
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestRunWorkflowCallingAgentWithInvalidName() {
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

// TestRunWorkflowCallingAgentMultipleTimes tests running the same workflow multiple times
// This verifies that multiple executions can be created for the same workflow
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestRunWorkflowCallingAgentMultipleTimes() {
	// Step 1: Apply workflow and agent
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	s.T().Logf("Step 1: Applying workflow and agent from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query workflow by slug
	org := "local" // Using local backend in tests
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query workflow by slug")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.T().Logf("✓ Workflow deployed with ID: %s", workflow.Metadata.Id)

	// Step 2: Run workflow first time
	s.T().Logf("Step 2: Running workflow first time...")

	runOutput1, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "simple-review",
		"--follow=false",
	)
	s.Require().NoError(err, "First run should succeed")

	// Extract first execution ID
	var executionID1 string
	runLines1 := strings.Split(runOutput1, "\n")
	for _, line := range runLines1 {
		if strings.Contains(line, "Execution ID:") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "ID:" && i+1 < len(parts) {
					executionID1 = strings.TrimSpace(parts[i+1])
					break
				}
			}
			if executionID1 != "" {
				break
			}
		}
	}
	s.NotEmpty(executionID1, "Should extract first execution ID")
	s.T().Logf("✓ First execution created: %s", executionID1)

	// Step 3: Run workflow second time
	s.T().Logf("Step 3: Running workflow second time...")

	runOutput2, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "simple-review",
		"--follow=false",
	)
	s.Require().NoError(err, "Second run should succeed")

	// Extract second execution ID
	var executionID2 string
	runLines2 := strings.Split(runOutput2, "\n")
	for _, line := range runLines2 {
		if strings.Contains(line, "Execution ID:") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "ID:" && i+1 < len(parts) {
					executionID2 = strings.TrimSpace(parts[i+1])
					break
				}
			}
			if executionID2 != "" {
				break
			}
		}
	}
	s.NotEmpty(executionID2, "Should extract second execution ID")
	s.T().Logf("✓ Second execution created: %s", executionID2)

	// Step 4: Verify both executions are different
	s.NotEqual(executionID1, executionID2, "Each run should create a unique execution ID")

	// Step 5: Verify both executions exist via API
	execution1Exists, err := WorkflowExecutionExistsViaAPI(s.Harness.ServerPort, executionID1)
	s.NoError(err, "Should be able to query first execution")
	s.True(execution1Exists, "First execution should exist")

	execution2Exists, err := WorkflowExecutionExistsViaAPI(s.Harness.ServerPort, executionID2)
	s.NoError(err, "Should be able to query second execution")
	s.True(execution2Exists, "Second execution should exist")

	s.T().Logf("✅ Multiple Execution Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   First Execution ID: %s", executionID1)
	s.T().Logf("   Second Execution ID: %s", executionID2)
	s.T().Logf("   Both executions created successfully with unique IDs")
}

// TestRunWorkflowCallingAgentVerifyMetadata tests that execution metadata is properly set
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestRunWorkflowCallingAgentVerifyMetadata() {
	// Step 1: Apply workflow and agent
	testdataDir := filepath.Join("testdata", "examples", "15-workflow-calling-simple-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to workflow-calling-simple-agent directory")

	s.T().Logf("Step 1: Applying workflow and agent from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query workflow by slug
	org := "local" // Using local backend in tests
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, "simple-review", org)
	s.Require().NoError(err, "Should be able to query workflow by slug")
	s.Require().NotNil(workflow, "Workflow should exist")
	s.T().Logf("✓ Workflow deployed with ID: %s", workflow.Metadata.Id)

	// Step 2: Run workflow
	s.T().Logf("Step 2: Running workflow...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "simple-review",
		"--follow=false",
	)
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
	s.NotEmpty(executionID, "Should extract execution ID")
	s.T().Logf("✓ Execution created: %s", executionID)

	// Step 3: Verify execution metadata via API
	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
	s.NoError(err, "Should be able to query execution via API")
	s.NotNil(execution, "Execution should exist")

	// Verify metadata fields
	s.NotNil(execution.Metadata, "Execution should have metadata")
	s.Equal(executionID, execution.Metadata.Id, "Execution ID should match")
	s.NotEmpty(execution.Metadata.Id, "Execution should have an ID")

	// Verify execution references the correct workflow
	s.NotNil(execution.Spec, "Execution should have spec")
	s.Equal(workflow.Metadata.Id, execution.Spec.WorkflowId, "Execution should reference the workflow")

	// Verify execution status
	s.NotNil(execution.Status, "Execution should have status")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING, execution.Status.Phase,
		"New execution should be in PENDING phase")

	s.T().Logf("✅ Metadata Verification Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", execution.Metadata.Id)
	s.T().Logf("   Execution references workflow: %s", execution.Spec.WorkflowId)
	s.T().Logf("   Execution phase: %s", execution.Status.Phase.String())
}
