//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
)

// TestWorkflowEnvVarInlineFlags tests --env and --secret flags for workflows.
//
// This test validates that:
// 1. --env KEY=VALUE flags are passed to workflow executions as non-secrets
// 2. --secret KEY=VALUE flags are passed to workflow executions as secrets
// 3. Workflows handle runtime_env the same way as agents
//
// Uses the basic workflow from SDK example 07_basic_workflow.go
func (s *E2ESuite) TestWorkflowEnvVarInlineFlags() {
	s.T().Logf("=== Testing Workflow --env and --secret Inline Flags ===")

	// STEP 1: Apply workflow first
	s.T().Logf("Step 1: Applying basic workflow...")
	applyResult := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("Workflow deployed: %s (ID: %s)", BasicWorkflowName, applyResult.Workflow.Metadata.Id)

	// STEP 2: Run workflow with --env flags
	s.T().Logf("Step 2: Running workflow with --env flags...")
	envVars := []string{
		EnvTestAPIURL + "=" + EnvTestAPIURLValue,
		EnvTestDebug + "=" + EnvTestDebugValue,
	}
	runResult := RunWorkflowWithEnv(s.T(), s.Harness.ServerPort, BasicWorkflowName, BasicWorkflowTestMessage, envVars)

	// STEP 3: Verify execution was created
	VerifyWorkflowRunOutputSuccess(s.T(), runResult.Output, BasicWorkflowName)

	// STEP 4: Query execution and verify env vars
	s.T().Logf("Step 3: Verifying workflow execution has correct env vars...")
	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get workflow execution via API")

	// Verify env vars exist and are NOT secrets
	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, EnvTestAPIURL, EnvTestAPIURLValue)
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, EnvTestAPIURL, false)

	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, EnvTestDebug, EnvTestDebugValue)
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, EnvTestDebug, false)

	s.T().Logf("Verified: Workflow --env flags create non-secret env vars")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}

// TestWorkflowEnvVarSecretFlags tests --secret flag for workflows.
//
// This test validates that:
// 1. --secret KEY=VALUE flags are passed as secrets (IsSecret=true)
// 2. Multiple --secret flags work correctly for workflows
//
// Uses the basic workflow from SDK example 07_basic_workflow.go
func (s *E2ESuite) TestWorkflowEnvVarSecretFlags() {
	s.T().Logf("=== Testing Workflow --secret Flags ===")

	// STEP 1: Apply workflow first
	s.T().Logf("Step 1: Applying basic workflow...")
	applyResult := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("Workflow deployed: %s (ID: %s)", BasicWorkflowName, applyResult.Workflow.Metadata.Id)

	// STEP 2: Run workflow with --secret flags
	s.T().Logf("Step 2: Running workflow with --secret flags...")
	secrets := []string{
		EnvTestDBPassword + "=" + EnvTestDBPasswordValue,
		EnvTestAPIKey + "=" + EnvTestAPIKeyValue,
	}
	runResult := RunWorkflowWithSecret(s.T(), s.Harness.ServerPort, BasicWorkflowName, BasicWorkflowTestMessage, secrets)

	// STEP 3: Verify execution was created
	VerifyWorkflowRunOutputSuccess(s.T(), runResult.Output, BasicWorkflowName)

	// STEP 4: Query execution and verify secrets
	s.T().Logf("Step 3: Verifying workflow execution has correct secrets...")
	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get workflow execution via API")

	// Verify secrets exist and ARE secrets
	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, EnvTestDBPassword, EnvTestDBPasswordValue)
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, EnvTestDBPassword, true)

	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, EnvTestAPIKey, EnvTestAPIKeyValue)
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, EnvTestAPIKey, true)

	s.T().Logf("Verified: Workflow --secret flags create secret env vars (IsSecret=true)")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}

// TestWorkflowEnvVarMergePrecedence tests precedence order for workflows.
//
// Precedence (highest to lowest):
// 1. --secret flags (inline secrets)
// 2. --env flags (inline env vars)
// 3. --secret-file (secret files)
// 4. --env-file (env files)
//
// Uses the basic workflow from SDK example 07_basic_workflow.go
func (s *E2ESuite) TestWorkflowEnvVarMergePrecedence() {
	s.T().Logf("=== Testing Workflow Environment Variable Merge Precedence ===")

	// STEP 1: Apply workflow first
	s.T().Logf("Step 1: Applying basic workflow...")
	applyResult := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("Workflow deployed: %s (ID: %s)", BasicWorkflowName, applyResult.Workflow.Metadata.Id)

	// STEP 2: Get absolute paths to test fixtures
	absEnvFile, err := filepath.Abs(EnvVarTestEnvFile)
	s.Require().NoError(err, "Should get absolute path to env file")
	absSecretFile, err := filepath.Abs(EnvVarTestSecretFile)
	s.Require().NoError(err, "Should get absolute path to secret file")

	// STEP 3: Run workflow with all env options
	s.T().Logf("Step 2: Running workflow with combined env sources...")
	runResult := RunWorkflowWithAllEnvOptions(
		s.T(),
		s.Harness.ServerPort,
		BasicWorkflowName,
		BasicWorkflowTestMessage,
		[]string{absEnvFile},     // env files (lowest precedence)
		[]string{absSecretFile},  // secret files
		[]string{"API_URL=https://override.api.com", "CUSTOM_VAR=from_flag"}, // env flags
		[]string{"DB_PASSWORD=flag_override_secret"}, // secret flags (highest precedence)
	)

	// STEP 4: Verify execution was created
	VerifyWorkflowRunOutputSuccess(s.T(), runResult.Output, BasicWorkflowName)

	// STEP 5: Query execution and verify precedence
	s.T().Logf("Step 3: Verifying merge precedence for workflow...")
	execution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err, "Should get workflow execution via API")

	// Verify API_URL was overridden by --env flag
	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, "API_URL", "https://override.api.com")
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, "API_URL", false)

	// Verify DB_PASSWORD was overridden by --secret flag
	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, "DB_PASSWORD", "flag_override_secret")
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, "DB_PASSWORD", true)

	// Verify CUSTOM_VAR from --env flag
	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, "CUSTOM_VAR", "from_flag")
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, "CUSTOM_VAR", false)

	// Verify values from files that weren't overridden
	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, "LOG_LEVEL", "info")
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, "LOG_LEVEL", false)

	VerifyWorkflowExecutionHasEnvVar(s.T(), execution, "API_KEY", "ghp_test_api_key_abc123")
	VerifyWorkflowEnvVarIsSecret(s.T(), execution, "API_KEY", true)

	s.T().Logf("Verified: Workflow merge precedence works correctly")
	s.T().Logf("Execution ID: %s", runResult.ExecutionID)
}
