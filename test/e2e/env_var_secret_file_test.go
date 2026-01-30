//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
)

// TestEnvVarSecretFile tests the --secret-file flag for loading secrets from files.
//
// This test validates that:
// 1. --secret-file PATH loads variables from a secret file
// 2. All values from --secret-file are marked as secrets (IsSecret=true)
// 3. Standard .env format is supported
//
// Uses the basic agent from SDK example 01_basic_agent.go
// Test fixture: testdata/examples/env-vars-test/.env.secret
func (s *E2ESuite) TestEnvVarSecretFile() {
	s.T().Logf("=== Testing --secret-file Flag ===")

	// STEP 1: Apply agents first
	s.T().Logf("Step 1: Applying basic agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("Agent deployed: %s (ID: %s)", BasicAgentName, applyResult.BasicAgent.Metadata.Id)

	// STEP 2: Get absolute path to test fixture
	absSecretFile, err := filepath.Abs(EnvVarTestSecretFile)
	s.Require().NoError(err, "Should get absolute path to secret file")

	// STEP 3: Run agent with --secret-file flag
	s.T().Logf("Step 2: Running agent with --secret-file %s...", absSecretFile)
	runResult := RunAgentWithSecretFile(s.T(), s.Harness.ServerPort, BasicAgentName, BasicAgentTestMessage, absSecretFile)

	// STEP 4: Verify execution was created
	VerifyRunOutputSuccess(s.T(), runResult.Output, BasicAgentName)

	// STEP 5: Query execution and verify secrets from file
	s.T().Logf("Step 3: Verifying execution has secrets from file...")
	execution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get execution via API")

	// Verify secrets from .env.secret file exist and ARE secrets
	// (values from testdata/examples/env-vars-test/.env.secret)
	VerifyExecutionHasEnvVar(s.T(), execution, "DB_PASSWORD", "test_secret_password_123")
	VerifyEnvVarIsSecret(s.T(), execution, "DB_PASSWORD", true)

	VerifyExecutionHasEnvVar(s.T(), execution, "API_KEY", "ghp_test_api_key_abc123")
	VerifyEnvVarIsSecret(s.T(), execution, "API_KEY", true)

	s.T().Logf("Verified: --secret-file loads secret env vars from file (IsSecret=true)")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}
