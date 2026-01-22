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
	output, err := RunCLI("apply", "--config", absTestdataDir)
	
	// Log output for debugging
	s.T().Logf("Apply command output:\n%s", output)
	
	// Verify command succeeded
	s.Require().NoError(err, "Apply command should succeed")
	
	// Verify success message in output
	s.Contains(output, "Deployment successful", "Output should contain success message")
	s.Contains(output, "test-agent", "Output should mention the deployed agent")

	// Verify agent was stored in database
	// The database path is {tempDir}/stigmer.db (set in harness)
	dbPath := filepath.Join(s.TempDir, "stigmer.db")
	s.T().Logf("Checking database at: %s", dbPath)

	// List all keys to see what's in the database (for debugging)
	keys, err := ListKeysFromDB(dbPath, "")
	if err == nil {
		s.T().Logf("Database keys found: %v", keys)
	} else {
		s.T().Logf("Failed to list database keys: %v", err)
	}

	// Try to find agent by various possible key patterns
	// Common patterns in stigmer could be:
	// - "agent:test-agent"
	// - "agents/test-agent"
	// - "local/agents/test-agent"
	// - or other patterns
	possibleKeys := []string{
		"agent:test-agent",
		"agents/test-agent",
		"local/agents/test-agent",
		"/agent/test-agent",
		"/agents/test-agent",
		"test-agent",
	}

	var foundKey string
	var agentData []byte
	
	// Try each possible key pattern
	for _, key := range possibleKeys {
		data, err := GetFromDB(dbPath, key)
		if err == nil && len(data) > 0 {
			foundKey = key
			agentData = data
			s.T().Logf("✅ Found agent data with key: %s", key)
			break
		}
	}

	// If we couldn't find it with specific keys, search through all keys
	if foundKey == "" && keys != nil {
		for _, key := range keys {
			if strings.Contains(key, "test-agent") || strings.Contains(key, "agent") {
				data, err := GetFromDB(dbPath, key)
				if err == nil && len(data) > 0 {
					foundKey = key
					agentData = data
					s.T().Logf("✅ Found agent data by searching keys: %s", key)
					break
				}
			}
		}
	}

	// Assert we found the agent
	s.NotEmpty(foundKey, "Should find agent in database with one of the expected keys")
	s.NotNil(agentData, "Agent data should not be nil")
	s.Greater(len(agentData), 0, "Agent data should not be empty")

	s.T().Logf("✅ Test passed: Agent was successfully applied and stored in database")
	s.T().Logf("   Database key: %s", foundKey)
	s.T().Logf("   Data size: %d bytes", len(agentData))
}

// TestApplyDryRun tests the dry-run mode of apply command
func (s *E2ESuite) TestApplyDryRun() {
	testdataDir := filepath.Join("..", "..", "test", "e2e", "testdata")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to testdata")

	// Execute apply with --dry-run flag
	output, err := RunCLI("apply", "--config", absTestdataDir, "--dry-run")
	
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
