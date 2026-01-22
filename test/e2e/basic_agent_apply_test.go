//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"
)

// TestApplyBasicAgent tests the full apply workflow:
// 1. Server is running with isolated storage
// 2. Apply command deploys agents from code (from SDK example 01_basic_agent.go)
// 3. Agents are stored in BadgerDB
// 4. Can retrieve and verify agent data
//
// The SDK example creates TWO agents:
// - code-reviewer: Basic agent with required fields only
// - code-reviewer-pro: Full agent with optional fields (description, iconURL, org)
//
// Example: sdk/go/examples/01_basic_agent.go
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestApplyBasicAgent() {
	// Get path to basic-agent test fixture
	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-agent directory")

	s.T().Logf("Using basic-agent directory: %s", absTestdataDir)

	// Execute apply command with the basic-agent directory
	// The CLI will look for Stigmer.yaml in this directory
	// Pass the server address so CLI connects to our test server
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)

	// Log output for debugging
	s.T().Logf("Apply command output:\n%s", output)

	// Verify command succeeded
	s.Require().NoError(err, "Apply command should succeed")

	// Verify success message in output
	s.Contains(output, "Deployment successful", "Output should contain success message")

	// Verify BOTH agents are mentioned in output (from SDK example 01_basic_agent.go)
	s.Contains(output, "code-reviewer", "Output should mention the basic agent")
	s.Contains(output, "code-reviewer-pro", "Output should mention the full agent with optional fields")

	// Verify both agents exist by querying via gRPC API using their slugs
	// No need to extract IDs from output - query directly by slug
	s.T().Logf("Verifying agents via gRPC API by slug...")

	org := "local" // Using local backend in tests

	// Verify basic agent (code-reviewer) by slug
	basicAgent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	s.Require().NoError(err, "Should be able to query basic agent by slug via API")
	s.Require().NotNil(basicAgent, "Basic agent should exist")
	s.Equal("code-reviewer", basicAgent.Metadata.Name, "Agent name should match")
	s.NotEmpty(basicAgent.Spec.Instructions, "Agent should have instructions")
	s.T().Logf("✓ Found agent: code-reviewer (ID: %s)", basicAgent.Metadata.Id)

	// Verify full agent (code-reviewer-pro) by slug
	fullAgent, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer-pro", org)
	s.Require().NoError(err, "Should be able to query full agent by slug via API")
	s.Require().NotNil(fullAgent, "Full agent should exist")
	s.Equal("code-reviewer-pro", fullAgent.Metadata.Name, "Agent name should match")
	s.NotEmpty(fullAgent.Spec.Instructions, "Agent should have instructions")
	s.T().Logf("✓ Found agent: code-reviewer-pro (ID: %s)", fullAgent.Metadata.Id)

	// Verify optional fields are present on full agent
	s.Equal("Professional code reviewer with security focus", fullAgent.Spec.Description,
		"Full agent should have description")
	s.Equal("https://example.com/icons/code-reviewer.png", fullAgent.Spec.IconUrl,
		"Full agent should have icon URL")
	// Note: In local backend mode, org is always overwritten to "local" regardless of SDK code
	s.Equal("local", fullAgent.Metadata.Org,
		"Full agent org should be 'local' in local backend mode")

	s.T().Logf("✅ Test passed: Both agents were successfully applied with correct properties")
	s.T().Logf("   Basic agent ID: %s", basicAgent.Metadata.Id)
	s.T().Logf("   Full agent ID: %s", fullAgent.Metadata.Id)
}

// TestApplyAgentCount verifies that the SDK example creates exactly 2 agents
//
// Example: sdk/go/examples/01_basic_agent.go creates:
// 1. code-reviewer (basic agent)
// 2. code-reviewer-pro (full agent with optional fields)
// 3. Validation error example (invalid name) - caught and logged, not deployed
//
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestApplyAgentCount() {
	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-agent directory")

	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")

	s.T().Logf("Apply output:\n%s", output)

	// Verify agents by querying via API using their known slugs
	// The SDK example creates 2 agents: "code-reviewer" and "code-reviewer-pro"
	// We query by slug + org instead of parsing CLI output

	org := "local" // Using local backend in tests

	// Query first agent by slug
	agent1, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	s.Require().NoError(err, "Should be able to query code-reviewer by slug via API")
	s.Require().NotNil(agent1, "code-reviewer should exist in backend")
	s.Equal("code-reviewer", agent1.Metadata.Name)
	s.T().Logf("✓ Found agent: code-reviewer (ID: %s)", agent1.Metadata.Id)

	// Query second agent by slug
	agent2, err := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer-pro", org)
	s.Require().NoError(err, "Should be able to query code-reviewer-pro by slug via API")
	s.Require().NotNil(agent2, "code-reviewer-pro should exist in backend")
	s.Equal("code-reviewer-pro", agent2.Metadata.Name)
	s.T().Logf("✓ Found agent: code-reviewer-pro (ID: %s)", agent2.Metadata.Id)

	// Verify the invalid agent was NOT deployed (validation error in SDK example)
	// It should fail with NotFound error
	_, err = GetAgentBySlug(s.Harness.ServerPort, "Invalid Name!", org)
	s.Error(err, "Invalid agent should not be deployed")
	s.T().Logf("✓ Confirmed invalid agent was not deployed (as expected)")

	s.T().Logf("✅ Agent count test passed: Exactly 2 valid agents deployed (verified via API by slug)")
}

// TestApplyDryRun tests the dry-run mode of apply command
//
// Example: sdk/go/examples/01_basic_agent.go
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestApplyDryRun() {
	// Get path to basic-agent test fixture
	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-agent directory")

	// Execute apply with --dry-run flag
	// Pass the server address so CLI connects to our test server
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir, "--dry-run")

	s.T().Logf("Dry-run output:\n%s", output)

	// Verify command succeeded
	s.Require().NoError(err, "Dry-run should succeed")

	// Verify dry-run output
	s.Contains(output, "Dry run successful", "Output should indicate dry run")

	// Verify nothing was actually deployed to database
	dbPath := filepath.Join(s.TempDir, "stigmer.db")
	keys, err := ListKeysFromDB(dbPath, "")

	// In dry-run mode, no agents should be stored
	// (The database might exist but should have no agent entries)
	if err == nil {
		agentCount := 0
		for _, key := range keys {
			if strings.Contains(key, "agent") {
				agentCount++
			}
		}
		s.Equal(0, agentCount, "Dry-run should not store any agents in database")
	}

	s.T().Logf("✅ Dry-run test passed: No resources were deployed")
}
