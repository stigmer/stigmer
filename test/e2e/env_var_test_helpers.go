//go:build e2e
// +build e2e

package e2e

import (
	"testing"

	"github.com/stretchr/testify/require"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// =============================================================================
// RESULT TYPES
// =============================================================================

// EnvVarRunResult holds the result of running an agent with environment variables
type EnvVarRunResult struct {
	ExecutionID string
	Output      string
}

// =============================================================================
// RUN HELPERS WITH ENVIRONMENT VARIABLES
// =============================================================================

// RunAgentWithEnv runs an agent by name with --env flags (non-secrets)
// Returns the execution ID and CLI output
func RunAgentWithEnv(t *testing.T, serverPort int, agentName string, message string, envVars []string) *EnvVarRunResult {
	t.Logf("Running agent '%s' with %d env vars", agentName, len(envVars))

	args := []string{"run", agentName, "--message", message, "--follow=false"}
	for _, env := range envVars {
		args = append(args, "--env", env)
	}

	output, err := RunCLIWithServerAddr(serverPort, args...)
	require.NoError(t, err, "Run command with --env should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractAgentExecutionID(t, output)
	require.NotEmpty(t, executionID, "Should extract execution ID from output")
	t.Logf("Execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// RunAgentWithSecret runs an agent by name with --secret flags (secrets)
// Returns the execution ID and CLI output
func RunAgentWithSecret(t *testing.T, serverPort int, agentName string, message string, secrets []string) *EnvVarRunResult {
	t.Logf("Running agent '%s' with %d secrets", agentName, len(secrets))

	args := []string{"run", agentName, "--message", message, "--follow=false"}
	for _, secret := range secrets {
		args = append(args, "--secret", secret)
	}

	output, err := RunCLIWithServerAddr(serverPort, args...)
	require.NoError(t, err, "Run command with --secret should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractAgentExecutionID(t, output)
	require.NotEmpty(t, executionID, "Should extract execution ID from output")
	t.Logf("Execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// RunAgentWithEnvFile runs an agent by name with --env-file flag
// Returns the execution ID and CLI output
func RunAgentWithEnvFile(t *testing.T, serverPort int, agentName string, message string, envFilePath string) *EnvVarRunResult {
	t.Logf("Running agent '%s' with env file: %s", agentName, envFilePath)

	output, err := RunCLIWithServerAddr(
		serverPort,
		"run", agentName,
		"--message", message,
		"--env-file", envFilePath,
		"--follow=false",
	)
	require.NoError(t, err, "Run command with --env-file should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractAgentExecutionID(t, output)
	require.NotEmpty(t, executionID, "Should extract execution ID from output")
	t.Logf("Execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// RunAgentWithSecretFile runs an agent by name with --secret-file flag
// Returns the execution ID and CLI output
func RunAgentWithSecretFile(t *testing.T, serverPort int, agentName string, message string, secretFilePath string) *EnvVarRunResult {
	t.Logf("Running agent '%s' with secret file: %s", agentName, secretFilePath)

	output, err := RunCLIWithServerAddr(
		serverPort,
		"run", agentName,
		"--message", message,
		"--secret-file", secretFilePath,
		"--follow=false",
	)
	require.NoError(t, err, "Run command with --secret-file should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractAgentExecutionID(t, output)
	require.NotEmpty(t, executionID, "Should extract execution ID from output")
	t.Logf("Execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// RunAgentWithAllEnvOptions runs an agent with all environment variable options
// This tests the full precedence: env files < secret files < env flags < secret flags
func RunAgentWithAllEnvOptions(
	t *testing.T,
	serverPort int,
	agentName string,
	message string,
	envFiles []string,
	secretFiles []string,
	envVars []string,
	secrets []string,
) *EnvVarRunResult {
	t.Logf("Running agent '%s' with full env config", agentName)

	args := []string{"run", agentName, "--message", message, "--follow=false"}

	for _, f := range envFiles {
		args = append(args, "--env-file", f)
	}
	for _, f := range secretFiles {
		args = append(args, "--secret-file", f)
	}
	for _, env := range envVars {
		args = append(args, "--env", env)
	}
	for _, secret := range secrets {
		args = append(args, "--secret", secret)
	}

	output, err := RunCLIWithServerAddr(serverPort, args...)
	require.NoError(t, err, "Run command with all env options should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractAgentExecutionID(t, output)
	require.NotEmpty(t, executionID, "Should extract execution ID from output")
	t.Logf("Execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// =============================================================================
// VERIFICATION HELPERS
// =============================================================================

// VerifyExecutionHasEnvVar verifies that an execution has a specific environment variable
func VerifyExecutionHasEnvVar(t *testing.T, execution *agentexecutionv1.AgentExecution, key string, expectedValue string) {
	require.NotNil(t, execution.Spec, "Execution should have spec")
	require.NotNil(t, execution.Spec.RuntimeEnv, "Execution should have runtime_env")

	envVal, exists := execution.Spec.RuntimeEnv[key]
	require.True(t, exists, "Execution should have env var: %s", key)
	require.Equal(t, expectedValue, envVal.Value, "Env var %s should have expected value", key)

	t.Logf("Verified env var: %s=%s", key, expectedValue)
}

// VerifyEnvVarIsSecret verifies that an environment variable is marked as a secret
func VerifyEnvVarIsSecret(t *testing.T, execution *agentexecutionv1.AgentExecution, key string, shouldBeSecret bool) {
	require.NotNil(t, execution.Spec, "Execution should have spec")
	require.NotNil(t, execution.Spec.RuntimeEnv, "Execution should have runtime_env")

	envVal, exists := execution.Spec.RuntimeEnv[key]
	require.True(t, exists, "Execution should have env var: %s", key)

	if shouldBeSecret {
		require.True(t, envVal.IsSecret, "Env var %s should be marked as secret", key)
		t.Logf("Verified env var %s is marked as SECRET", key)
	} else {
		require.False(t, envVal.IsSecret, "Env var %s should NOT be marked as secret", key)
		t.Logf("Verified env var %s is NOT marked as secret", key)
	}
}

// VerifyExecutionEnvVarCount verifies the total number of environment variables
func VerifyExecutionEnvVarCount(t *testing.T, execution *agentexecutionv1.AgentExecution, expectedCount int) {
	require.NotNil(t, execution.Spec, "Execution should have spec")

	actualCount := 0
	if execution.Spec.RuntimeEnv != nil {
		actualCount = len(execution.Spec.RuntimeEnv)
	}

	require.Equal(t, expectedCount, actualCount,
		"Execution should have %d env vars, got %d", expectedCount, actualCount)

	t.Logf("Verified env var count: %d", actualCount)
}

// =============================================================================
// WORKFLOW RUN HELPERS WITH ENVIRONMENT VARIABLES
// =============================================================================

// RunWorkflowWithEnv runs a workflow by name with --env flags (non-secrets)
// Returns the execution ID and CLI output
func RunWorkflowWithEnv(t *testing.T, serverPort int, workflowName string, message string, envVars []string) *EnvVarRunResult {
	t.Logf("Running workflow '%s' with %d env vars", workflowName, len(envVars))

	args := []string{"run", workflowName, "--message", message, "--follow=false"}
	for _, env := range envVars {
		args = append(args, "--env", env)
	}

	output, err := RunCLIWithServerAddr(serverPort, args...)
	require.NoError(t, err, "Run workflow with --env should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractExecutionIDFromOutput(t, output)
	require.NotEmpty(t, executionID, "Should extract workflow execution ID from output")
	t.Logf("Workflow execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// RunWorkflowWithSecret runs a workflow by name with --secret flags (secrets)
// Returns the execution ID and CLI output
func RunWorkflowWithSecret(t *testing.T, serverPort int, workflowName string, message string, secrets []string) *EnvVarRunResult {
	t.Logf("Running workflow '%s' with %d secrets", workflowName, len(secrets))

	args := []string{"run", workflowName, "--message", message, "--follow=false"}
	for _, secret := range secrets {
		args = append(args, "--secret", secret)
	}

	output, err := RunCLIWithServerAddr(serverPort, args...)
	require.NoError(t, err, "Run workflow with --secret should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractExecutionIDFromOutput(t, output)
	require.NotEmpty(t, executionID, "Should extract workflow execution ID from output")
	t.Logf("Workflow execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// RunWorkflowWithAllEnvOptions runs a workflow with all environment variable options
// This tests the full precedence: env files < secret files < env flags < secret flags
func RunWorkflowWithAllEnvOptions(
	t *testing.T,
	serverPort int,
	workflowName string,
	message string,
	envFiles []string,
	secretFiles []string,
	envVars []string,
	secrets []string,
) *EnvVarRunResult {
	t.Logf("Running workflow '%s' with full env config", workflowName)

	args := []string{"run", workflowName, "--message", message, "--follow=false"}

	for _, f := range envFiles {
		args = append(args, "--env-file", f)
	}
	for _, f := range secretFiles {
		args = append(args, "--secret-file", f)
	}
	for _, env := range envVars {
		args = append(args, "--env", env)
	}
	for _, secret := range secrets {
		args = append(args, "--secret", secret)
	}

	output, err := RunCLIWithServerAddr(serverPort, args...)
	require.NoError(t, err, "Run workflow with all env options should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractExecutionIDFromOutput(t, output)
	require.NotEmpty(t, executionID, "Should extract workflow execution ID from output")
	t.Logf("Workflow execution created with ID: %s", executionID)

	return &EnvVarRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// =============================================================================
// WORKFLOW VERIFICATION HELPERS
// =============================================================================

// VerifyWorkflowExecutionHasEnvVar verifies that a workflow execution has a specific environment variable
func VerifyWorkflowExecutionHasEnvVar(t *testing.T, execution *workflowexecutionv1.WorkflowExecution, key string, expectedValue string) {
	require.NotNil(t, execution.Spec, "Workflow execution should have spec")
	require.NotNil(t, execution.Spec.RuntimeEnv, "Workflow execution should have runtime_env")

	envVal, exists := execution.Spec.RuntimeEnv[key]
	require.True(t, exists, "Workflow execution should have env var: %s", key)
	require.Equal(t, expectedValue, envVal.Value, "Env var %s should have expected value", key)

	t.Logf("Verified workflow env var: %s=%s", key, expectedValue)
}

// VerifyWorkflowEnvVarIsSecret verifies that a workflow environment variable is marked as a secret
func VerifyWorkflowEnvVarIsSecret(t *testing.T, execution *workflowexecutionv1.WorkflowExecution, key string, shouldBeSecret bool) {
	require.NotNil(t, execution.Spec, "Workflow execution should have spec")
	require.NotNil(t, execution.Spec.RuntimeEnv, "Workflow execution should have runtime_env")

	envVal, exists := execution.Spec.RuntimeEnv[key]
	require.True(t, exists, "Workflow execution should have env var: %s", key)

	if shouldBeSecret {
		require.True(t, envVal.IsSecret, "Workflow env var %s should be marked as secret", key)
		t.Logf("Verified workflow env var %s is marked as SECRET", key)
	} else {
		require.False(t, envVal.IsSecret, "Workflow env var %s should NOT be marked as secret", key)
		t.Logf("Verified workflow env var %s is NOT marked as secret", key)
	}
}
