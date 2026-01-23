//go:build e2e
// +build e2e

package e2e

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
)

// ============================================================================
// RESULT TYPES
// ============================================================================

// AgentApplyResult holds the result of applying agents from SDK example
type AgentApplyResult struct {
	BasicAgent *agentv1.Agent
	FullAgent  *agentv1.Agent
	Output     string
}

// AgentInstanceResult holds agent instance verification results
type AgentInstanceResult struct {
	Instance   *agentinstancev1.AgentInstance
	InstanceID string
}

// AgentRunResult holds the result of running an agent
type AgentRunResult struct {
	Execution   *agentexecutionv1.AgentExecution
	ExecutionID string
	Output      string
}

// ============================================================================
// APPLY HELPERS
// ============================================================================

// ApplyBasicAgents applies agents from SDK example 01_basic_agent.go
// Returns both agents (basic and full) and CLI output
func ApplyBasicAgents(t *testing.T, serverPort int) *AgentApplyResult {
	// Get absolute path to test fixture
	absTestdataDir, err := filepath.Abs(BasicAgentTestDataDir)
	require.NoError(t, err, "Failed to get absolute path to basic-agent directory")

	t.Logf("Applying agents from: %s", absTestdataDir)

	// Execute apply command
	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir)
	require.NoError(t, err, "Apply command should succeed")

	t.Logf("Apply command output:\n%s", output)

	// Query both agents by slug
	basicAgent, err := GetAgentBySlug(serverPort, BasicAgentName, LocalOrg)
	require.NoError(t, err, "Should be able to query basic agent by slug via API")
	require.NotNil(t, basicAgent, "Basic agent should exist")

	fullAgent, err := GetAgentBySlug(serverPort, FullAgentName, LocalOrg)
	require.NoError(t, err, "Should be able to query full agent by slug via API")
	require.NotNil(t, fullAgent, "Full agent should exist")

	t.Logf("✓ Agents deployed: %s (ID: %s), %s (ID: %s)",
		BasicAgentName, basicAgent.Metadata.Id,
		FullAgentName, fullAgent.Metadata.Id)

	return &AgentApplyResult{
		BasicAgent: basicAgent,
		FullAgent:  fullAgent,
		Output:     output,
	}
}

// ApplyBasicAgentsDryRun executes apply with --dry-run flag
// Returns CLI output without deploying resources
func ApplyBasicAgentsDryRun(t *testing.T, serverPort int) string {
	absTestdataDir, err := filepath.Abs(BasicAgentTestDataDir)
	require.NoError(t, err, "Failed to get absolute path to basic-agent directory")

	t.Logf("Executing dry-run from: %s", absTestdataDir)

	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir, "--dry-run")
	require.NoError(t, err, "Dry-run command should succeed")

	t.Logf("Dry-run output:\n%s", output)

	return output
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

// VerifyAgentApplyOutputSuccess verifies the apply command output contains success indicators
func VerifyAgentApplyOutputSuccess(t *testing.T, output string) {
	require.Contains(t, output, "Deployment successful", "Output should contain success message")
	require.Contains(t, output, BasicAgentName, "Output should mention basic agent")
	require.Contains(t, output, FullAgentName, "Output should mention full agent")

	// Verify table format
	require.Contains(t, output, "TYPE", "Output should contain table header")
	require.Contains(t, output, "NAME", "Output should contain table header")
	require.Contains(t, output, "STATUS", "Output should contain table header")
	require.Contains(t, output, "ID", "Output should contain table header")
	require.Contains(t, output, "Agent", "Output should contain resource type")
	require.Contains(t, output, "✓ Created", "Output should show creation status")

	t.Logf("✓ Apply output verified: Success message and table format present")
}

// VerifyAgentDryRunOutput verifies dry-run output format
func VerifyAgentDryRunOutput(t *testing.T, output string) {
	require.Contains(t, output, "Dry run successful", "Output should indicate dry run")

	// Verify dry-run table format
	require.Contains(t, output, "TYPE", "Dry-run output should contain table header")
	require.Contains(t, output, "NAME", "Dry-run output should contain table header")
	require.Contains(t, output, "ACTION", "Dry-run output should contain table header")
	require.Contains(t, output, "Agent", "Dry-run output should contain resource type")
	require.Contains(t, output, "Create", "Dry-run output should show action")

	t.Logf("✓ Dry-run output verified: Dry run successful with proper table format")
}

// VerifyAgentBasicProperties verifies core properties from SDK example
func VerifyAgentBasicProperties(t *testing.T, agent *agentv1.Agent, expectedName string) {
	require.Equal(t, expectedName, agent.Metadata.Name,
		"Agent name should match SDK example")
	require.Equal(t, LocalOrg, agent.Metadata.Org,
		"Agent org should be 'local' in local backend mode")
	require.NotEmpty(t, agent.Spec.Instructions,
		"Agent should have instructions from SDK example")

	t.Logf("✓ Basic properties verified: name=%s, org=%s",
		agent.Metadata.Name, agent.Metadata.Org)
}

// VerifyFullAgentOptionalFields verifies optional fields on the full agent
func VerifyFullAgentOptionalFields(t *testing.T, agent *agentv1.Agent) {
	require.Equal(t, FullAgentDescription, agent.Spec.Description,
		"Full agent should have description from SDK example")
	require.Equal(t, FullAgentIconURL, agent.Spec.IconUrl,
		"Full agent should have icon URL from SDK example")
	require.Equal(t, LocalOrg, agent.Metadata.Org,
		"Full agent org should be 'local' in local backend mode")

	t.Logf("✓ Optional fields verified: description=%s, iconUrl=%s",
		agent.Spec.Description, agent.Spec.IconUrl)
}

// VerifyAgentDefaultInstance verifies that an agent has a default instance created
func VerifyAgentDefaultInstance(t *testing.T, serverPort int, agent *agentv1.Agent, expectedInstanceName string) *AgentInstanceResult {
	require.NotNil(t, agent.Status, "Agent should have status")
	require.NotEmpty(t, agent.Status.DefaultInstanceId, "Agent should have default_instance_id")

	instanceID := agent.Status.DefaultInstanceId
	t.Logf("✓ Agent has default instance ID: %s", instanceID)

	instance, err := GetAgentInstanceViaAPI(serverPort, instanceID)
	require.NoError(t, err, "Should be able to query agent's default instance")
	require.NotNil(t, instance, "Agent's default instance should exist")
	require.Equal(t, agent.Metadata.Id, instance.Spec.AgentId, "Instance should reference agent")
	require.Equal(t, expectedInstanceName, instance.Metadata.Name, "Default instance should have expected name")

	t.Logf("✓ Default instance verified: %s (ID: %s)", instance.Metadata.Name, instanceID)

	return &AgentInstanceResult{
		Instance:   instance,
		InstanceID: instanceID,
	}
}

// VerifyAgentCount verifies that exactly the expected number of agents were created
func VerifyAgentCount(t *testing.T, serverPort int) {
	// Query both agents by slug
	agent1, err := GetAgentBySlug(serverPort, BasicAgentName, LocalOrg)
	require.NoError(t, err, "Should be able to query %s by slug via API", BasicAgentName)
	require.NotNil(t, agent1, "%s should exist in backend", BasicAgentName)
	require.Equal(t, BasicAgentName, agent1.Metadata.Name)
	t.Logf("✓ Found agent: %s (ID: %s)", BasicAgentName, agent1.Metadata.Id)

	agent2, err := GetAgentBySlug(serverPort, FullAgentName, LocalOrg)
	require.NoError(t, err, "Should be able to query %s by slug via API", FullAgentName)
	require.NotNil(t, agent2, "%s should exist in backend", FullAgentName)
	require.Equal(t, FullAgentName, agent2.Metadata.Name)
	t.Logf("✓ Found agent: %s (ID: %s)", FullAgentName, agent2.Metadata.Id)

	// Verify the invalid agent was NOT deployed
	_, err = GetAgentBySlug(serverPort, InvalidAgentName, LocalOrg)
	require.Error(t, err, "Invalid agent should not be deployed")
	t.Logf("✓ Confirmed invalid agent was not deployed (as expected)")

	t.Logf("✅ Agent count verified: Exactly %d valid agents deployed", BasicAgentCount)
}

// ============================================================================
// RUN HELPERS
// ============================================================================

// RunAgentByName runs an agent by name and returns the execution result
func RunAgentByName(t *testing.T, serverPort int, agentName string, message string) *AgentRunResult {
	t.Logf("Running agent '%s' with message: %s", agentName, message)

	output, err := RunCLIWithServerAddr(
		serverPort,
		"run", agentName,
		"--message", message,
		"--follow=false", // Don't stream logs in CLI, we'll poll via API
	)

	t.Logf("Run command output:\n%s", output)
	require.NoError(t, err, "Run command should succeed")

	// Extract execution ID from output
	executionID := extractAgentExecutionID(t, output)
	require.NotEmpty(t, executionID, "Should be able to extract execution ID from output")
	t.Logf("✓ Execution created with ID: %s", executionID)

	return &AgentRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// VerifyRunOutputSuccess verifies the run command output contains success indicators
func VerifyRunOutputSuccess(t *testing.T, output string, agentName string) {
	require.Contains(t, output, "Agent execution started", "Output should indicate execution started")
	require.Contains(t, output, agentName, "Output should mention the agent name")

	t.Logf("✓ Run output verified: Execution started for agent '%s'", agentName)
}

// WaitForAgentExecutionCompletion polls the agent execution status until it reaches a terminal state
// Returns the final execution state or an error if timeout or execution failed
func WaitForAgentExecutionCompletion(t *testing.T, serverPort int, executionID string, timeoutSeconds int) *agentexecutionv1.AgentExecution {
	t.Logf("Waiting for execution to complete (timeout: %ds)...", timeoutSeconds)

	timeout := time.After(time.Duration(timeoutSeconds) * time.Second)
	ticker := time.NewTicker(1 * time.Second) // Poll every second
	defer ticker.Stop()

	var lastPhase agentexecutionv1.ExecutionPhase
	pollCount := 0

	for {
		select {
		case <-timeout:
			require.FailNow(t, fmt.Sprintf("timeout waiting for execution to complete after %d seconds (last phase: %s)",
				timeoutSeconds, lastPhase.String()))

		case <-ticker.C:
			pollCount++
			execution, err := GetAgentExecutionViaAPI(serverPort, executionID)
			require.NoError(t, err, "Failed to query execution")

			if execution.Status == nil {
				continue // Wait for status to be populated
			}

			currentPhase := execution.Status.Phase

			// Log phase changes
			if currentPhase != lastPhase {
				t.Logf("   [Poll %d] Phase transition: %s → %s",
					pollCount, lastPhase.String(), currentPhase.String())
				lastPhase = currentPhase
			}

			// Check for terminal states
			switch currentPhase {
			case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
				t.Logf("   ✓ Execution completed successfully after %d polls", pollCount)
				return execution

			case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
				// Log error messages
				t.Logf("   ❌ Execution FAILED after %d polls", pollCount)
				if len(execution.Status.Messages) > 0 {
					for _, msg := range execution.Status.Messages {
						t.Logf("      Error: %s", msg.Content)
					}
				}
				require.FailNow(t, fmt.Sprintf("execution failed (phase: %s)", currentPhase.String()))

			case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
				t.Logf("   ⚠️  Execution was cancelled after %d polls", pollCount)
				require.FailNow(t, "execution was cancelled")

			default:
				// Still in progress (PENDING or IN_PROGRESS), continue polling
				continue
			}
		}
	}
}

// VerifyAgentExecutionCompleted verifies that an execution completed successfully
func VerifyAgentExecutionCompleted(t *testing.T, execution *agentexecutionv1.AgentExecution) {
	require.NotNil(t, execution, "Execution should exist")
	require.NotNil(t, execution.Status, "Execution should have status")
	require.Equal(t, agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution.Status.Phase,
		"Execution should complete successfully")

	t.Logf("✓ Execution phase verified: %s", execution.Status.Phase)
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

// extractAgentExecutionID extracts the execution ID from run command output
func extractAgentExecutionID(t *testing.T, output string) string {
	// Output format: "Execution ID: agex_1234567890"
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "Execution ID:") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "ID:" && i+1 < len(parts) {
					return strings.TrimSpace(parts[i+1])
				}
			}
		}
	}
	return ""
}
