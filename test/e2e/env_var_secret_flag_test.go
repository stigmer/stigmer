//go:build e2e
// +build e2e

package e2e

// TestEnvVarSecretFlags tests the --secret flag for inline secret variables.
//
// This test validates that:
// 1. --secret KEY=VALUE flags are correctly parsed
// 2. Values are passed to the execution as secrets (IsSecret=true)
// 3. Multiple --secret flags can be used together
//
// Uses the basic agent from SDK example 01_basic_agent.go
func (s *E2ESuite) TestEnvVarSecretFlags() {
	s.T().Logf("=== Testing --secret Inline Flags ===")

	// STEP 1: Apply agents first
	s.T().Logf("Step 1: Applying basic agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("Agent deployed: %s (ID: %s)", BasicAgentName, applyResult.BasicAgent.Metadata.Id)

	// STEP 2: Run agent with --secret flags
	s.T().Logf("Step 2: Running agent with --secret flags...")
	secrets := []string{
		EnvTestDBPassword + "=" + EnvTestDBPasswordValue,
		EnvTestAPIKey + "=" + EnvTestAPIKeyValue,
	}
	runResult := RunAgentWithSecret(s.T(), s.Harness.ServerPort, BasicAgentName, BasicAgentTestMessage, secrets)

	// STEP 3: Verify execution was created
	VerifyRunOutputSuccess(s.T(), runResult.Output, BasicAgentName)

	// STEP 4: Query execution and verify secrets
	s.T().Logf("Step 3: Verifying execution has correct secrets...")
	execution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get execution via API")

	// Verify secrets exist and ARE secrets
	VerifyExecutionHasEnvVar(s.T(), execution, EnvTestDBPassword, EnvTestDBPasswordValue)
	VerifyEnvVarIsSecret(s.T(), execution, EnvTestDBPassword, true)

	VerifyExecutionHasEnvVar(s.T(), execution, EnvTestAPIKey, EnvTestAPIKeyValue)
	VerifyEnvVarIsSecret(s.T(), execution, EnvTestAPIKey, true)

	s.T().Logf("Verified: --secret flags create secret env vars (IsSecret=true)")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}
