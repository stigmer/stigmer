//go:build e2e
// +build e2e

package e2e

// TestEnvVarInlineFlags tests the --env flag for inline environment variables.
//
// This test validates that:
// 1. --env KEY=VALUE flags are correctly parsed
// 2. Values are passed to the execution as non-secrets
// 3. Multiple --env flags can be used together
//
// Uses the basic agent from SDK example 01_basic_agent.go
func (s *E2ESuite) TestEnvVarInlineFlags() {
	s.T().Logf("=== Testing --env Inline Flags ===")

	// STEP 1: Apply agents first
	s.T().Logf("Step 1: Applying basic agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("Agent deployed: %s (ID: %s)", BasicAgentName, applyResult.BasicAgent.Metadata.Id)

	// STEP 2: Run agent with --env flags
	s.T().Logf("Step 2: Running agent with --env flags...")
	envVars := []string{
		EnvTestAPIURL + "=" + EnvTestAPIURLValue,
		EnvTestDebug + "=" + EnvTestDebugValue,
	}
	runResult := RunAgentWithEnv(s.T(), s.Harness.ServerPort, BasicAgentName, BasicAgentTestMessage, envVars)

	// STEP 3: Verify execution was created
	VerifyRunOutputSuccess(s.T(), runResult.Output, BasicAgentName)

	// STEP 4: Query execution and verify env vars
	s.T().Logf("Step 3: Verifying execution has correct env vars...")
	execution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get execution via API")

	// Verify env vars exist and are NOT secrets
	VerifyExecutionHasEnvVar(s.T(), execution, EnvTestAPIURL, EnvTestAPIURLValue)
	VerifyEnvVarIsSecret(s.T(), execution, EnvTestAPIURL, false)

	VerifyExecutionHasEnvVar(s.T(), execution, EnvTestDebug, EnvTestDebugValue)
	VerifyEnvVarIsSecret(s.T(), execution, EnvTestDebug, false)

	s.T().Logf("Verified: --env flags create non-secret env vars")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}
