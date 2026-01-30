//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
)

// TestEnvVarIsSecretFlag tests that the IsSecret flag is correctly set based on source.
//
// This test validates the Pulumi-style explicit secret marking:
// - --env and --env-file always create non-secrets (IsSecret=false)
// - --secret and --secret-file always create secrets (IsSecret=true)
//
// This is a critical security test to ensure secrets are properly marked
// for encryption in the backend.
//
// Uses the basic agent from SDK example 01_basic_agent.go
func (s *E2ESuite) TestEnvVarIsSecretFlag() {
	s.T().Logf("=== Testing IsSecret Flag Behavior ===")

	// STEP 1: Apply agents first
	s.T().Logf("Step 1: Applying basic agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("Agent deployed: %s (ID: %s)", BasicAgentName, applyResult.BasicAgent.Metadata.Id)

	// STEP 2: Get absolute paths to test fixtures
	absEnvFile, err := filepath.Abs(EnvVarTestEnvFile)
	s.Require().NoError(err, "Should get absolute path to env file")
	absSecretFile, err := filepath.Abs(EnvVarTestSecretFile)
	s.Require().NoError(err, "Should get absolute path to secret file")

	// STEP 3: Run agent with both env and secret sources
	s.T().Logf("Step 2: Running agent with env and secret sources...")
	runResult := RunAgentWithAllEnvOptions(
		s.T(),
		s.Harness.ServerPort,
		BasicAgentName,
		BasicAgentTestMessage,
		[]string{absEnvFile},                 // env file (non-secrets)
		[]string{absSecretFile},              // secret file (secrets)
		[]string{"INLINE_ENV=inline_value"},  // --env flag (non-secret)
		[]string{"INLINE_SECRET=inline_sec"}, // --secret flag (secret)
	)

	// STEP 4: Verify execution was created
	VerifyRunOutputSuccess(s.T(), runResult.Output, BasicAgentName)

	// STEP 5: Query execution
	s.T().Logf("Step 3: Verifying IsSecret flags...")
	execution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get execution via API")

	// =========================================================================
	// Test 1: Values from --env-file are NOT secrets
	// =========================================================================
	s.T().Logf("Checking: --env-file values are NOT secrets...")
	VerifyEnvVarIsSecret(s.T(), execution, "API_URL", false)
	VerifyEnvVarIsSecret(s.T(), execution, "DEBUG", false)
	VerifyEnvVarIsSecret(s.T(), execution, "LOG_LEVEL", false)

	// =========================================================================
	// Test 2: Values from --secret-file ARE secrets
	// =========================================================================
	s.T().Logf("Checking: --secret-file values ARE secrets...")
	VerifyEnvVarIsSecret(s.T(), execution, "DB_PASSWORD", true)
	VerifyEnvVarIsSecret(s.T(), execution, "API_KEY", true)

	// =========================================================================
	// Test 3: Values from --env flag are NOT secrets
	// =========================================================================
	s.T().Logf("Checking: --env flag values are NOT secrets...")
	VerifyEnvVarIsSecret(s.T(), execution, "INLINE_ENV", false)

	// =========================================================================
	// Test 4: Values from --secret flag ARE secrets
	// =========================================================================
	s.T().Logf("Checking: --secret flag values ARE secrets...")
	VerifyEnvVarIsSecret(s.T(), execution, "INLINE_SECRET", true)

	s.T().Logf("Verified: IsSecret flag correctly set based on source")
	s.T().Logf("  - --env and --env-file: IsSecret=false")
	s.T().Logf("  - --secret and --secret-file: IsSecret=true")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}
