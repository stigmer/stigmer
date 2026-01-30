//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
)

// TestEnvVarEnvFile tests the --env-file flag for loading environment from files.
//
// This test validates that:
// 1. --env-file PATH loads variables from a .env file
// 2. All values from --env-file are marked as non-secrets
// 3. Standard .env format is supported (comments, empty lines, quotes)
//
// Uses the basic agent from SDK example 01_basic_agent.go
// Test fixture: testdata/examples/env-vars-test/.env
func (s *E2ESuite) TestEnvVarEnvFile() {
	s.T().Logf("=== Testing --env-file Flag ===")

	// STEP 1: Apply agents first
	s.T().Logf("Step 1: Applying basic agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("Agent deployed: %s (ID: %s)", BasicAgentName, applyResult.BasicAgent.Metadata.Id)

	// STEP 2: Get absolute path to test fixture
	absEnvFile, err := filepath.Abs(EnvVarTestEnvFile)
	s.Require().NoError(err, "Should get absolute path to env file")

	// STEP 3: Run agent with --env-file flag
	s.T().Logf("Step 2: Running agent with --env-file %s...", absEnvFile)
	runResult := RunAgentWithEnvFile(s.T(), s.Harness.ServerPort, BasicAgentName, BasicAgentTestMessage, absEnvFile)

	// STEP 4: Verify execution was created
	VerifyRunOutputSuccess(s.T(), runResult.Output, BasicAgentName)

	// STEP 5: Query execution and verify env vars from file
	s.T().Logf("Step 3: Verifying execution has env vars from file...")
	execution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get execution via API")

	// Verify env vars from .env file exist and are NOT secrets
	// (values from testdata/examples/env-vars-test/.env)
	VerifyExecutionHasEnvVar(s.T(), execution, "API_URL", "https://api.test.stigmer.ai")
	VerifyEnvVarIsSecret(s.T(), execution, "API_URL", false)

	VerifyExecutionHasEnvVar(s.T(), execution, "DEBUG", "false")
	VerifyEnvVarIsSecret(s.T(), execution, "DEBUG", false)

	VerifyExecutionHasEnvVar(s.T(), execution, "LOG_LEVEL", "info")
	VerifyEnvVarIsSecret(s.T(), execution, "LOG_LEVEL", false)

	s.T().Logf("Verified: --env-file loads non-secret env vars from file")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}
