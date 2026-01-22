//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"
)

// TestRunBasicAgent tests the run command workflow (Phase 1 - smoke test):
// 1. Apply a basic agent (from SDK example 01_basic_agent.go)
// 2. Execute 'stigmer run' command
// 3. Verify execution record is created
// 4. Does NOT wait for actual execution (requires Temporal + agent-runner)
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
	s.T().Logf("   Agent ID: %s", agent.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Execution record created successfully")
	s.T().Logf("")
	s.T().Logf("Note: This test only verifies execution creation.")
	s.T().Logf("      Actual execution requires Temporal + agent-runner (Phase 2)")
}

// TestRunFullAgent tests running the full agent with optional fields
// This verifies that agents with description, iconURL, and org work correctly
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
	s.T().Logf("Step 2: Running code-reviewer-pro agent (execution creation only)...")

	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "code-reviewer-pro", // Use full agent name from SDK example
		"--message", "Hello, this is testing the full agent!",
		"--follow=false", // Don't stream logs (Phase 2 will test this)
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

	// Step 4: Verify execution exists via API
	s.T().Logf("Step 3: Verifying execution exists via API...")

	executionExists, err := AgentExecutionExistsViaAPI(s.Harness.ServerPort, executionID)
	s.NoError(err, "Should be able to query execution via API")
	s.True(executionExists, "Execution should exist when queried via API")

	s.T().Logf("✅ Full Agent Run Test Passed!")
	s.T().Logf("   Agent ID: %s", fullAgent.Metadata.Id)
	s.T().Logf("   Execution ID: %s", executionID)
	s.T().Logf("   Verified: Agent with optional fields (description, iconURL, org) works correctly")
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
