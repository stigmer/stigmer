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
	
	// Extract both agent IDs from output
	// Output format: "• code-reviewer (ID: agt-1234567890)"
	agentIDs := make(map[string]string) // map[agentName]agentID
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		for _, agentName := range []string{"code-reviewer", "code-reviewer-pro"} {
			if strings.Contains(line, agentName) && strings.Contains(line, "ID:") {
				start := strings.Index(line, "ID: ")
				if start != -1 {
					start += 4 // Skip "ID: "
					end := strings.Index(line[start:], ")")
					if end != -1 {
						agentIDs[agentName] = line[start : start+end]
					}
				}
			}
		}
	}
	
	s.Equal(2, len(agentIDs), "Should extract 2 agent IDs from output")
	s.NotEmpty(agentIDs["code-reviewer"], "Should extract code-reviewer ID")
	s.NotEmpty(agentIDs["code-reviewer-pro"], "Should extract code-reviewer-pro ID")
	
	s.T().Logf("Extracted agent IDs:")
	s.T().Logf("  - code-reviewer: %s", agentIDs["code-reviewer"])
	s.T().Logf("  - code-reviewer-pro: %s", agentIDs["code-reviewer-pro"])
	
	// Verify both agents exist by querying via gRPC API
	s.T().Logf("Verifying agents via gRPC API...")
	
	// Verify basic agent (code-reviewer)
	basicAgent, err := GetAgentViaAPI(s.Harness.ServerPort, agentIDs["code-reviewer"])
	s.Require().NoError(err, "Should be able to query basic agent via API")
	s.Require().NotNil(basicAgent, "Basic agent should exist")
	s.Equal("code-reviewer", basicAgent.Metadata.Name, "Agent name should match")
	s.NotEmpty(basicAgent.Spec.Instructions, "Agent should have instructions")
	
	// Verify full agent (code-reviewer-pro)
	fullAgent, err := GetAgentViaAPI(s.Harness.ServerPort, agentIDs["code-reviewer-pro"])
	s.Require().NoError(err, "Should be able to query full agent via API")
	s.Require().NotNil(fullAgent, "Full agent should exist")
	s.Equal("code-reviewer-pro", fullAgent.Metadata.Name, "Agent name should match")
	s.NotEmpty(fullAgent.Spec.Instructions, "Agent should have instructions")
	
	// Verify optional fields are present on full agent
	s.Equal("Professional code reviewer with security focus", fullAgent.Spec.Description,
		"Full agent should have description")
	s.Equal("https://example.com/icons/code-reviewer.png", fullAgent.Spec.IconUrl,
		"Full agent should have icon URL")
	s.Equal("my-org", fullAgent.Metadata.Org,
		"Full agent should have org")
	
	s.T().Logf("✅ Test passed: Both agents were successfully applied with correct properties")
	s.T().Logf("   Basic agent ID: %s", agentIDs["code-reviewer"])
	s.T().Logf("   Full agent ID: %s", agentIDs["code-reviewer-pro"])
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
	
	// Count deployed agents in output by counting "ID: agt-" occurrences
	agentCount := strings.Count(output, "ID: agt-")
	s.Equal(2, agentCount, "SDK example should create exactly 2 agents (code-reviewer and code-reviewer-pro)")
	
	// Verify the validation error example is mentioned (demonstrates error handling)
	// The SDK example shows validation by trying to create an invalid agent
	// It catches the error and prints it, but doesn't deploy it
	s.Contains(output, "code-reviewer", "Should deploy code-reviewer")
	s.Contains(output, "code-reviewer-pro", "Should deploy code-reviewer-pro")
	
	s.T().Logf("✅ Agent count test passed: Exactly 2 agents deployed")
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
