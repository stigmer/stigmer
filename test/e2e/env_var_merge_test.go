//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
)

// TestEnvVarMergePrecedence tests the precedence order when combining multiple env sources.
//
// Precedence (highest to lowest):
// 1. --secret flags (inline secrets)
// 2. --env flags (inline env vars)
// 3. --secret-file (secret files)
// 4. --env-file (env files)
//
// This test validates that:
// 1. Later sources override earlier sources for the same key
// 2. The IsSecret flag is preserved from the winning source
// 3. All sources are merged correctly
//
// Uses the basic agent from SDK example 01_basic_agent.go
func (s *E2ESuite) TestEnvVarMergePrecedence() {
	s.T().Logf("=== Testing Environment Variable Merge Precedence ===")

	// STEP 1: Apply agents first
	s.T().Logf("Step 1: Applying basic agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("Agent deployed: %s (ID: %s)", BasicAgentName, applyResult.BasicAgent.Metadata.Id)

	// STEP 2: Get absolute paths to test fixtures
	absEnvFile, err := filepath.Abs(EnvVarTestEnvFile)
	s.Require().NoError(err, "Should get absolute path to env file")
	absSecretFile, err := filepath.Abs(EnvVarTestSecretFile)
	s.Require().NoError(err, "Should get absolute path to secret file")

	// STEP 3: Run agent with all env options
	// The .env file has API_URL=https://api.test.stigmer.ai
	// We'll override it with --env flag
	s.T().Logf("Step 2: Running agent with combined env sources...")
	runResult := RunAgentWithAllEnvOptions(
		s.T(),
		s.Harness.ServerPort,
		BasicAgentName,
		BasicAgentTestMessage,
		[]string{absEnvFile},     // env files (lowest precedence)
		[]string{absSecretFile},  // secret files
		[]string{"API_URL=https://override.api.com", "CUSTOM_VAR=from_flag"}, // env flags
		[]string{"DB_PASSWORD=flag_override_secret"}, // secret flags (highest precedence)
	)

	// STEP 4: Verify execution was created
	VerifyRunOutputSuccess(s.T(), runResult.Output, BasicAgentName)

	// STEP 5: Query execution and verify precedence
	s.T().Logf("Step 3: Verifying merge precedence...")
	execution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get execution via API")

	// Verify API_URL was overridden by --env flag (file had https://api.test.stigmer.ai)
	VerifyExecutionHasEnvVar(s.T(), execution, "API_URL", "https://override.api.com")
	VerifyEnvVarIsSecret(s.T(), execution, "API_URL", false) // --env creates non-secrets

	// Verify DB_PASSWORD was overridden by --secret flag (file had test_secret_password_123)
	VerifyExecutionHasEnvVar(s.T(), execution, "DB_PASSWORD", "flag_override_secret")
	VerifyEnvVarIsSecret(s.T(), execution, "DB_PASSWORD", true) // --secret creates secrets

	// Verify CUSTOM_VAR from --env flag (not in any file)
	VerifyExecutionHasEnvVar(s.T(), execution, "CUSTOM_VAR", "from_flag")
	VerifyEnvVarIsSecret(s.T(), execution, "CUSTOM_VAR", false)

	// Verify values from files that weren't overridden
	VerifyExecutionHasEnvVar(s.T(), execution, "LOG_LEVEL", "info") // from .env file
	VerifyEnvVarIsSecret(s.T(), execution, "LOG_LEVEL", false)

	VerifyExecutionHasEnvVar(s.T(), execution, "API_KEY", "ghp_test_api_key_abc123") // from .env.secret
	VerifyEnvVarIsSecret(s.T(), execution, "API_KEY", true)

	s.T().Logf("Verified: Merge precedence works correctly")
	s.T().Logf("  - --env flag overrides --env-file")
	s.T().Logf("  - --secret flag overrides --secret-file")
	s.T().Logf("  - IsSecret flag preserved from winning source")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}
