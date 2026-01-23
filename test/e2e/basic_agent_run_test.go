//go:build e2e
// +build e2e

package e2e

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// TestRunBasicAgent tests the complete agent execution workflow:
// 1. Apply a basic agent (from SDK example 01_basic_agent.go)
// 2. Execute 'stigmer run' command
// 3. Wait for execution to complete
// 4. Verify execution completed successfully
//
// Example: sdk/go/examples/01_basic_agent.go
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestRunBasicAgent() {
	// Step 1: Apply an agent first
	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-agent directory")

	s.T().Logf("Step 1: Applying agent from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query agent by slug instead of extracting ID from output
	org := "local" // Using local backend in tests
	agent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	s.Require().NoError(err, "Should be able to query agent by slug")
	s.Require().NotNil(agent, "Agent should exist")
	s.T().Logf("✓ Agent deployed with ID: %s", agent.Metadata.Id)

	// Step 2: Run the agent by name (not ID)
	s.T().Logf("Step 2: Running agent and creating execution...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "code-reviewer", // Use agent name from SDK example (01_basic_agent.go)
		"--message", "Hello, test agent!",
		"--follow=false", // Don't stream logs in CLI, we'll poll via API
	)

	s.T().Logf("Run command output:\n%s", runOutput)
	s.Require().NoError(err, "Run command should succeed")

	// Step 3: Verify execution was created
	s.Contains(runOutput, "Agent execution started", "Output should indicate execution started")
	s.Contains(runOutput, "code-reviewer", "Output should mention the agent name (from SDK example)")

	// Extract execution ID from output
	// Output format: "Execution ID: agex_1234567890"
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

	// Step 3: Wait for execution to complete
	s.T().Logf("Step 3: Waiting for execution to complete (timeout: 60s)...")

	execution, err := s.waitForAgentExecutionCompletion(executionID, 60)
	s.Require().NoError(err, "Execution should complete successfully")

	// Step 4: Verify execution completed successfully
	s.T().Logf("Step 4: Verifying execution completed successfully...")
	s.NotNil(execution, "Execution should exist")
	s.NotNil(execution.Status, "Execution should have status")

	s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution.Status.Phase,
		"Execution should complete successfully")

	s.T().Logf("✅ Test Passed!")
	s.T().Logf("   Agent ID: %s", agent.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Final phase: %s", execution.Status.Phase)
}

// TestRunFullAgent tests the complete execution workflow for agents with optional fields
// This verifies that agents with description, iconURL, and org execute correctly
//
// Example: sdk/go/examples/01_basic_agent.go (code-reviewer-pro agent)
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestRunFullAgent() {
	// Step 1: Apply agents (both code-reviewer and code-reviewer-pro)
	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-agent directory")

	s.T().Logf("Step 1: Applying agents from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", applyOutput)

	// Query agent by slug instead of extracting ID from output
	org := "local" // Using local backend in tests
	fullAgent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer-pro", org)
	s.Require().NoError(err, "Should be able to query agent by slug")
	s.Require().NotNil(fullAgent, "Agent should exist")
	s.T().Logf("✓ code-reviewer-pro agent deployed with ID: %s", fullAgent.Metadata.Id)

	// Verify optional fields are present
	s.Equal("Professional code reviewer with security focus", fullAgent.Spec.Description)
	s.Equal("https://example.com/icons/code-reviewer.png", fullAgent.Spec.IconUrl)
	// Note: In local backend mode, org is always overwritten to "local" regardless of SDK code
	s.Equal("local", fullAgent.Metadata.Org)

	s.T().Logf("✓ Verified optional fields on code-reviewer-pro agent")

	// Step 2: Run the full agent by name
	s.T().Logf("Step 2: Running code-reviewer-pro agent and creating execution...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "code-reviewer-pro", // Use full agent name from SDK example
		"--message", "Hello, this is testing the full agent!",
		"--follow=false", // Don't stream logs in CLI, we'll poll via API
	)

	s.T().Logf("Run command output:\n%s", runOutput)
	s.Require().NoError(err, "Run command should succeed")

	// Step 3: Verify execution was created
	s.Contains(runOutput, "Agent execution started", "Output should indicate execution started")
	s.Contains(runOutput, "code-reviewer-pro", "Output should mention the full agent name")

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

	// Step 3: Wait for execution to complete
	s.T().Logf("Step 3: Waiting for execution to complete (timeout: 60s)...")

	execution, err := s.waitForAgentExecutionCompletion(executionID, 60)
	s.Require().NoError(err, "Execution should complete successfully")

	// Step 4: Verify execution completed successfully
	s.T().Logf("Step 4: Verifying execution completed successfully...")
	s.NotNil(execution, "Execution should exist")
	s.NotNil(execution.Status, "Execution should have status")

	s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution.Status.Phase,
		"Execution should complete successfully")

	s.T().Logf("✅ Full Agent Run Test Passed!")
	s.T().Logf("   Agent ID: %s", fullAgent.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Final phase: %s", execution.Status.Phase)
	s.T().Logf("   Verified: Agent with optional fields (description, iconURL, org) executes successfully")
}

// TestRunWithAutoDiscovery tests the auto-discovery mode (no agent reference provided)
//
// Example: sdk/go/examples/01_basic_agent.go
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestRunWithAutoDiscovery() {
	// This test runs 'stigmer run' from the basic-agent directory
	// It should auto-discover the agent and run it

	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-agent directory")

	s.T().Logf("Testing auto-discovery mode from: %s", absTestdataDir)

	// Run without specifying agent (should auto-discover)
	// Note: We need to change working directory for this to work
	// For now, let's skip this test as it requires more complex setup
	// TODO: Implement in future iteration

	s.T().Skip("Auto-discovery mode requires changing working directory - implement in Phase 2")
}

// waitForAgentExecutionCompletion polls the agent execution status until it reaches a terminal state
// Returns the final execution state or an error if timeout or execution failed
func (s *E2ESuite) waitForAgentExecutionCompletion(executionID string, timeoutSeconds int) (*agentexecutionv1.AgentExecution, error) {
	timeout := time.After(time.Duration(timeoutSeconds) * time.Second)
	ticker := time.NewTicker(1 * time.Second) // Poll every second
	defer ticker.Stop()

	var lastPhase agentexecutionv1.ExecutionPhase
	pollCount := 0

	for {
		select {
		case <-timeout:
			return nil, fmt.Errorf("timeout waiting for execution to complete after %d seconds (last phase: %s)",
				timeoutSeconds, lastPhase.String())

		case <-ticker.C:
			pollCount++
			execution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, executionID)
			if err != nil {
				return nil, fmt.Errorf("failed to query execution: %w", err)
			}

			if execution.Status == nil {
				continue // Wait for status to be populated
			}

			currentPhase := execution.Status.Phase

			// Log phase changes
			if currentPhase != lastPhase {
				s.T().Logf("   [Poll %d] Phase transition: %s → %s",
					pollCount, lastPhase.String(), currentPhase.String())
				lastPhase = currentPhase
			}

			// Check for terminal states
			switch currentPhase {
			case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
				s.T().Logf("   ✓ Execution completed successfully after %d polls", pollCount)
				return execution, nil

			case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
				// Log error messages
				s.T().Logf("   ❌ Execution FAILED after %d polls", pollCount)
				if len(execution.Status.Messages) > 0 {
					for _, msg := range execution.Status.Messages {
						s.T().Logf("      Error: %s", msg.Content)
					}
				}
				return execution, fmt.Errorf("execution failed (phase: %s)", currentPhase.String())

			case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
				s.T().Logf("   ⚠️  Execution was cancelled after %d polls", pollCount)
				return execution, fmt.Errorf("execution was cancelled")

			default:
				// Still in progress (PENDING or IN_PROGRESS), continue polling
				continue
			}
		}
	}
}
