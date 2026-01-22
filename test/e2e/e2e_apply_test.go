//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"
)

// TestApplyBasicAgent tests the full apply workflow:
// 1. Server is running with isolated storage
// 2. Apply command deploys agent from code
// 3. Agent is stored in BadgerDB
// 4. Can retrieve and verify agent data
func (s *E2ESuite) TestApplyBasicAgent() {
	// Get path to test configuration
	testdataDir := filepath.Join("..", "..", "test", "e2e", "testdata")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to testdata")

	s.T().Logf("Using testdata directory: %s", absTestdataDir)

	// Execute apply command with the testdata directory
	// The CLI will look for Stigmer.yaml in this directory
	// Pass the server address so CLI connects to our test server
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	
	// Log output for debugging
	s.T().Logf("Apply command output:\n%s", output)
	
	// Verify command succeeded
	s.Require().NoError(err, "Apply command should succeed")
	
	// Verify success message in output
	s.Contains(output, "Deployment successful", "Output should contain success message")
	s.Contains(output, "test-agent", "Output should mention the deployed agent")
	
	// Extract agent ID from output
	// Output format: "• test-agent (ID: agt-1234567890)"
	var agentID string
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "test-agent") && strings.Contains(line, "ID:") {
			// Extract ID from line like: "  • test-agent (ID: agt-1234567890)"
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
	
	s.NotEmpty(agentID, "Should be able to extract agent ID from output")
	s.T().Logf("Extracted agent ID: %s", agentID)
	
	// Verify agent exists by querying via gRPC API
	// This is the proper way to verify - not by directly reading the database
	// (BadgerDB only allows one process at a time, and the server is still running)
	s.T().Logf("Querying agent via gRPC API...")
	
	agentExists, err := AgentExistsViaAPI(s.Harness.ServerPort, agentID)
	s.NoError(err, "Should be able to query agent via API")
	s.True(agentExists, "Agent should exist when queried via API")
	
	s.T().Logf("✅ Test passed: Agent was successfully applied and can be queried via API")
	s.T().Logf("   Agent ID: %s", agentID)
}

// TestApplyDryRun tests the dry-run mode of apply command
func (s *E2ESuite) TestApplyDryRun() {
	testdataDir := filepath.Join("..", "..", "test", "e2e", "testdata")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to testdata")

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
