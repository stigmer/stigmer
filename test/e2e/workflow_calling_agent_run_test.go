//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestRunWorkflowCallingAgent tests the run command workflow:
// 1. Apply a workflow that calls an agent (from SDK example 15_workflow_calling_simple_agent.go)
// 2. Execute 'stigmer run' command for the workflow
// 3. Verify execution record is created
// 4. Wait for execution to complete (or fail)
// 5. Verify execution reached a terminal state without errors
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
	s.T().Logf("Step 2: Running workflow...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "simple-review", // Use workflow name from SDK example
		"--follow=false", // Don't stream logs for this test
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

	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
	s.Require().NoError(err, "Should be able to query execution via API")
	s.Require().NotNil(execution, "Execution should exist")

	// Step 5: Wait for execution to complete (or fail)
	s.T().Logf("Step 4: Waiting for execution to complete (timeout: 30s)...")
	
	completedExecution, err := WaitForWorkflowExecutionPhase(
		s.Harness.ServerPort,
		executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)

	// Check if execution completed successfully
	if err != nil {
		// Get the current execution state for detailed error reporting
		currentExecution, getErr := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
		if getErr != nil {
			s.T().Fatalf("❌ Execution failed and couldn't retrieve status: %v (original error: %v)", getErr, err)
		}

		// Report detailed failure information
		s.T().Logf("❌ Execution did not complete successfully")
		s.T().Logf("   Current Phase: %s", currentExecution.Status.Phase.String())
		if currentExecution.Status.Error != "" {
			s.T().Logf("   Error Message: %s", currentExecution.Status.Error)
		}
		
		// Fail the test with clear information
		s.Require().NoError(err, "Workflow execution should complete successfully")
	}

	s.Require().NotNil(completedExecution, "Completed execution should not be nil")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, completedExecution.Status.Phase,
		"Execution should be in COMPLETED phase")

	s.T().Logf("✅ Test Passed!")
	s.T().Logf("   Agent ID: %s", agent.Metadata.Id)
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Execution completed successfully")
}

// TestRunWorkflowCallingAgentVerifyPhase tests workflow execution phase progression
// Verifies execution starts in PENDING and progresses to COMPLETED
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
	s.T().Logf("Step 2: Running workflow...")

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

	// Step 3: Verify execution starts in PENDING phase
	initialExecution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
	s.Require().NoError(err, "Should be able to query execution via API")
	s.Require().NotNil(initialExecution, "Execution should exist")

	s.T().Logf("✓ Initial execution phase: %s", initialExecution.Status.Phase.String())

	// Step 4: Wait for execution to complete
	s.T().Logf("Step 3: Waiting for execution to complete (timeout: 30s)...")
	
	completedExecution, err := WaitForWorkflowExecutionPhase(
		s.Harness.ServerPort,
		executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)

	// Check if execution completed successfully
	if err != nil {
		// Get the current execution state for detailed error reporting
		currentExecution, getErr := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
		if getErr != nil {
			s.T().Fatalf("❌ Execution failed and couldn't retrieve status: %v (original error: %v)", getErr, err)
		}

		// Report detailed failure information
		s.T().Logf("❌ Execution phase progression failed")
		s.T().Logf("   Initial Phase: %s", initialExecution.Status.Phase.String())
		s.T().Logf("   Current Phase: %s", currentExecution.Status.Phase.String())
		if currentExecution.Status.Error != "" {
			s.T().Logf("   Error Message: %s", currentExecution.Status.Error)
		}
		
		// Fail the test with clear information
		s.Require().NoError(err, "Workflow execution should complete successfully")
	}

	s.Require().NotNil(completedExecution, "Completed execution should not be nil")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, completedExecution.Status.Phase,
		"Execution should be in COMPLETED phase")

	s.T().Logf("✅ Execution Phase Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Initial Phase: %s", initialExecution.Status.Phase.String())
	s.T().Logf("   Final Phase: %s", completedExecution.Status.Phase.String())
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
// This verifies that multiple executions can be created and completed for the same workflow
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

	// Step 5: Wait for both executions to complete
	s.T().Logf("Step 4: Waiting for both executions to complete...")

	execution1, err := WaitForWorkflowExecutionPhase(
		s.Harness.ServerPort,
		executionID1,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)
	if err != nil {
		currentExec1, _ := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID1)
		if currentExec1 != nil {
			s.T().Logf("❌ First execution failed - Phase: %s, Error: %s", 
				currentExec1.Status.Phase.String(), currentExec1.Status.Error)
		}
		s.Require().NoError(err, "First execution should complete successfully")
	}
	s.T().Logf("✓ First execution completed: %s", executionID1)

	execution2, err := WaitForWorkflowExecutionPhase(
		s.Harness.ServerPort,
		executionID2,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)
	if err != nil {
		currentExec2, _ := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID2)
		if currentExec2 != nil {
			s.T().Logf("❌ Second execution failed - Phase: %s, Error: %s", 
				currentExec2.Status.Phase.String(), currentExec2.Status.Error)
		}
		s.Require().NoError(err, "Second execution should complete successfully")
	}
	s.T().Logf("✓ Second execution completed: %s", executionID2)

	// Verify both are in COMPLETED phase
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution1.Status.Phase)
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution2.Status.Phase)

	s.T().Logf("✅ Multiple Execution Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   First Execution ID: %s (Phase: %s)", executionID1, execution1.Status.Phase.String())
	s.T().Logf("   Second Execution ID: %s (Phase: %s)", executionID2, execution2.Status.Phase.String())
	s.T().Logf("   Both executions completed successfully with unique IDs")
}

// TestRunWorkflowCallingAgentVerifyMetadata tests that execution metadata is properly set
// and execution completes successfully
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

	// Step 3: Verify initial execution metadata via API
	initialExecution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
	s.Require().NoError(err, "Should be able to query execution via API")
	s.Require().NotNil(initialExecution, "Execution should exist")

	// Verify metadata fields
	s.NotNil(initialExecution.Metadata, "Execution should have metadata")
	s.Equal(executionID, initialExecution.Metadata.Id, "Execution ID should match")
	s.NotEmpty(initialExecution.Metadata.Id, "Execution should have an ID")

	// Verify execution references the correct workflow
	s.NotNil(initialExecution.Spec, "Execution should have spec")
	s.Equal(workflow.Metadata.Id, initialExecution.Spec.WorkflowId, "Execution should reference the workflow")

	// Verify execution status
	s.NotNil(initialExecution.Status, "Execution should have status")
	s.T().Logf("✓ Initial execution phase: %s", initialExecution.Status.Phase.String())

	// Step 4: Wait for execution to complete
	s.T().Logf("Step 3: Waiting for execution to complete (timeout: 30s)...")
	
	completedExecution, err := WaitForWorkflowExecutionPhase(
		s.Harness.ServerPort,
		executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		30*time.Second,
	)

	// Check if execution completed successfully
	if err != nil {
		currentExecution, getErr := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, executionID)
		if getErr != nil {
			s.T().Fatalf("❌ Execution failed and couldn't retrieve status: %v (original error: %v)", getErr, err)
		}

		// Report detailed failure information
		s.T().Logf("❌ Execution metadata test failed")
		s.T().Logf("   Execution ID: %s", executionID)
		s.T().Logf("   Current Phase: %s", currentExecution.Status.Phase.String())
		if currentExecution.Status.Error != "" {
			s.T().Logf("   Error Message: %s", currentExecution.Status.Error)
		}
		
		s.Require().NoError(err, "Workflow execution should complete successfully")
	}

	s.Require().NotNil(completedExecution, "Completed execution should not be nil")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, completedExecution.Status.Phase,
		"Execution should be in COMPLETED phase")

	s.T().Logf("✅ Metadata Verification Test Passed!")
	s.T().Logf("   Workflow ID: %s", workflow.Metadata.Id)
	s.T().Logf("   Execution ID: %s", completedExecution.Metadata.Id)
	s.T().Logf("   Execution references workflow: %s", completedExecution.Spec.WorkflowId)
	s.T().Logf("   Final execution phase: %s", completedExecution.Status.Phase.String())
}
