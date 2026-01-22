//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"
)

// TestRunBasicAgent tests the run command workflow (Phase 1 - smoke test):
// 1. Apply a basic agent
// 2. Execute 'stigmer run' command
// 3. Verify execution record is created
// 4. Does NOT wait for actual execution (requires Temporal + agent-runner)
func (s *E2ESuite) TestRunBasicAgent() {
	// Step 1: Apply an agent first
	testdataDir := filepath.Join("..", "..", "test", "e2e", "testdata")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to testdata")

	s.T().Logf("Step 1: Applying agent from: %s", absTestdataDir)

	applyOutput, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")
	
	s.T().Logf("Apply output:\n%s", applyOutput)

	// Extract agent ID from apply output
	// Output format: "• code-reviewer (ID: agt-1234567890)"
	var agentID string
	lines := strings.Split(applyOutput, "\n")
	for _, line := range lines {
		if strings.Contains(line, "code-reviewer") && strings.Contains(line, "ID:") {
			start := strings.Index(line, "ID: ")
			if start != -1 {
				start += 4 // Skip "ID: "
				end := strings.Index(line[start:], ")")
				if end != -1 {
					agentID = line[start : start+end]
					break
				}
			}
		}
	}

	s.NotEmpty(agentID, "Should be able to extract agent ID from apply output")
	s.T().Logf("✓ Agent deployed with ID: %s", agentID)

	// Step 2: Run the agent by name (not ID)
	// This creates an execution but doesn't wait for it to complete
	s.T().Logf("Step 2: Running agent (execution creation only)...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "code-reviewer", // Use agent name from SDK example (01_basic_agent.go)
		"--message", "Hello, test agent!",
		"--follow=false", // Don't stream logs (Phase 2 will test this)
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

	// Step 4: Verify execution exists via API
	s.T().Logf("Step 3: Verifying execution exists via API...")

	executionExists, err := AgentExecutionExistsViaAPI(s.Harness.ServerPort, executionID)
	s.NoError(err, "Should be able to query execution via API")
	s.True(executionExists, "Execution should exist when queried via API")

	s.T().Logf("✅ Phase 1 Test Passed!")
	s.T().Logf("   Agent ID: %s", agentID)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Execution record created successfully")
	s.T().Logf("")
	s.T().Logf("Note: This test only verifies execution creation.")
	s.T().Logf("      Actual execution requires Temporal + agent-runner (Phase 2)")
}

// TestRunWithAutoDiscovery tests the auto-discovery mode (no agent reference provided)
func (s *E2ESuite) TestRunWithAutoDiscovery() {
	// This test runs 'stigmer run' from the testdata directory
	// It should auto-discover the agent and run it

	testdataDir := filepath.Join("..", "..", "test", "e2e", "testdata")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to testdata")

	s.T().Logf("Testing auto-discovery mode from: %s", absTestdataDir)

	// Run without specifying agent (should auto-discover)
	// Note: We need to change working directory for this to work
	// For now, let's skip this test as it requires more complex setup
	// TODO: Implement in future iteration

	s.T().Skip("Auto-discovery mode requires changing working directory - implement in Phase 2")
}

// TestRunWithInvalidAgent tests error handling when agent doesn't exist
func (s *E2ESuite) TestRunWithInvalidAgent() {
	s.T().Logf("Testing run with non-existent agent...")

	// Try to run an agent that doesn't exist
	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "non-existent-agent",
		"--follow=false",
	)

	// CLI prints error message but doesn't crash (good UX)
	// So we don't check for error, just check the output

	// Should have helpful error message
	s.Contains(output, "not found", "Output should indicate agent was not found")
	s.Contains(output, "non-existent-agent", "Output should mention the agent name")

	s.T().Logf("✓ Error handling works correctly (graceful error message)")
	s.T().Logf("Error output:\n%s", output)
	
	// If there was an error, that's okay too (both behaviors are acceptable)
	if err != nil {
		s.T().Logf("Note: Command exited with error code (also valid behavior)")
	}
}
