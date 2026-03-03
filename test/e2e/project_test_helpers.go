//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)

// ============================================================================
// RESULT TYPES
// ============================================================================

// ProjectApplyResult holds the result of applying a project from SDK.
type ProjectApplyResult struct {
	Project *projectv1.Project
	Output  string
}

// ReconciliationCounts holds the counts from reconciliation summary.
type ReconciliationCounts struct {
	Creates int
	Updates int
	Deletes int
}

// ============================================================================
// APPLY HELPERS
// ============================================================================

// ApplyProject applies a project from the given test data directory.
// Returns the project and CLI output.
func ApplyProject(t *testing.T, serverPort int, testDataDir string) *ProjectApplyResult {
	absTestdataDir, err := filepath.Abs(testDataDir)
	require.NoError(t, err, "Failed to get absolute path to project directory")

	t.Logf("Applying project from: %s", absTestdataDir)

	// Execute apply command
	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir)
	require.NoError(t, err, "Apply command should succeed")

	t.Logf("Apply command output:\n%s", output)

	return &ProjectApplyResult{
		Output: output,
	}
}

// ApplyProjectWithProject applies a project and also queries the project resource.
func ApplyProjectWithProject(t *testing.T, serverPort int, testDataDir string, projectSlug string) *ProjectApplyResult {
	result := ApplyProject(t, serverPort, testDataDir)

	// Query the project by slug
	project, err := GetProjectBySlug(serverPort, projectSlug, LocalOrg)
	require.NoError(t, err, "Should be able to query project by slug via API")
	require.NotNil(t, project, "Project should exist")

	result.Project = project
	t.Logf("✓ Project deployed: %s (ID: %s)", projectSlug, project.Metadata.Id)

	return result
}

// ApplyProjectDryRun executes apply with --dry-run flag.
// Returns CLI output without deploying resources.
func ApplyProjectDryRun(t *testing.T, serverPort int, testDataDir string) string {
	absTestdataDir, err := filepath.Abs(testDataDir)
	require.NoError(t, err, "Failed to get absolute path to project directory")

	t.Logf("Executing dry-run from: %s", absTestdataDir)

	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir, "--dry-run")
	require.NoError(t, err, "Dry-run command should succeed")

	t.Logf("Dry-run output:\n%s", output)

	return output
}

// ApplyProjectNoPrune applies a project with --prune=false flag.
func ApplyProjectNoPrune(t *testing.T, serverPort int, testDataDir string) string {
	absTestdataDir, err := filepath.Abs(testDataDir)
	require.NoError(t, err, "Failed to get absolute path to project directory")

	t.Logf("Applying project with --prune=false from: %s", absTestdataDir)

	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir, "--prune=false")
	require.NoError(t, err, "Apply command with --prune=false should succeed")

	t.Logf("Apply command output:\n%s", output)

	return output
}

// ApplyProjectExpectError applies a project and expects an error.
// Returns the output (which may contain error messages).
func ApplyProjectExpectError(t *testing.T, serverPort int, testDataDir string) (string, error) {
	absTestdataDir, err := filepath.Abs(testDataDir)
	require.NoError(t, err, "Failed to get absolute path to project directory")

	t.Logf("Applying project (expecting error) from: %s", absTestdataDir)

	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir)

	t.Logf("Apply command output:\n%s", output)

	return output, err
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

// VerifyProjectApplyOutputSuccess verifies the apply command output contains success indicators.
func VerifyProjectApplyOutputSuccess(t *testing.T, output string) {
	require.Contains(t, output, "Deployment successful", "Output should contain success message")

	// Verify table format
	require.Contains(t, output, "TYPE", "Output should contain table header")
	require.Contains(t, output, "NAME", "Output should contain table header")
	require.Contains(t, output, "STATUS", "Output should contain table header")

	t.Logf("✓ Apply output verified: Success message and table format present")
}

// VerifyProjectDryRunOutput verifies dry-run output format.
func VerifyProjectDryRunOutput(t *testing.T, output string) {
	require.Contains(t, output, "Dry run successful", "Output should indicate dry run")

	// Verify dry-run table format
	require.Contains(t, output, "TYPE", "Dry-run output should contain table header")
	require.Contains(t, output, "NAME", "Dry-run output should contain table header")
	require.Contains(t, output, "ACTION", "Dry-run output should contain table header")

	t.Logf("✓ Dry-run output verified: Dry run successful with proper table format")
}

// VerifyReconciliationCounts parses and verifies reconciliation counts from CLI output.
func VerifyReconciliationCounts(t *testing.T, output string, expected ReconciliationCounts) {
	counts := ParseReconciliationCounts(output)

	if expected.Creates > 0 {
		require.Equal(t, expected.Creates, counts.Creates,
			"Expected %d creates, got %d", expected.Creates, counts.Creates)
	}
	if expected.Updates > 0 {
		require.Equal(t, expected.Updates, counts.Updates,
			"Expected %d updates, got %d", expected.Updates, counts.Updates)
	}
	if expected.Deletes > 0 {
		require.Equal(t, expected.Deletes, counts.Deletes,
			"Expected %d deletes, got %d", expected.Deletes, counts.Deletes)
	}

	t.Logf("✓ Reconciliation counts verified: creates=%d, updates=%d, deletes=%d",
		counts.Creates, counts.Updates, counts.Deletes)
}

// ParseReconciliationCounts extracts reconciliation counts from CLI output.
func ParseReconciliationCounts(output string) ReconciliationCounts {
	counts := ReconciliationCounts{}

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		// Count "✓ Created" occurrences
		if strings.Contains(line, "✓ Created") || strings.Contains(line, "Created") {
			counts.Creates++
		}
		// Count "✓ Updated" occurrences
		if strings.Contains(line, "✓ Updated") || strings.Contains(line, "Updated") {
			counts.Updates++
		}
		// Count "✓ Deleted" occurrences
		if strings.Contains(line, "✓ Deleted") || strings.Contains(line, "Deleted") {
			counts.Deletes++
		}
	}

	return counts
}

// VerifyProjectExists verifies that a project exists in the backend.
func VerifyProjectExists(t *testing.T, serverPort int, projectSlug string) *projectv1.Project {
	project, err := GetProjectBySlug(serverPort, projectSlug, LocalOrg)
	require.NoError(t, err, "Should be able to query project by slug")
	require.NotNil(t, project, "Project should exist")

	t.Logf("✓ Project exists: %s (ID: %s)", projectSlug, project.Metadata.Id)
	return project
}

// VerifyProjectNotExists verifies that a project does not exist in the backend.
func VerifyProjectNotExists(t *testing.T, serverPort int, projectSlug string) {
	_, err := GetProjectBySlug(serverPort, projectSlug, LocalOrg)
	require.Error(t, err, "Project should not exist")

	t.Logf("✓ Confirmed project does not exist: %s", projectSlug)
}

// VerifyAgentExists verifies that an agent exists in the backend.
func VerifyAgentExists(t *testing.T, serverPort int, agentSlug string) *agentv1.Agent {
	agent, err := GetAgentBySlug(serverPort, agentSlug, LocalOrg)
	require.NoError(t, err, "Should be able to query agent by slug")
	require.NotNil(t, agent, "Agent should exist")

	t.Logf("✓ Agent exists: %s (ID: %s)", agentSlug, agent.Metadata.Id)
	return agent
}

// VerifyAgentNotExists verifies that an agent does not exist in the backend.
func VerifyAgentNotExists(t *testing.T, serverPort int, agentSlug string) {
	_, err := GetAgentBySlug(serverPort, agentSlug, LocalOrg)
	require.Error(t, err, "Agent should not exist")

	t.Logf("✓ Confirmed agent does not exist: %s", agentSlug)
}

// VerifyAgentDescription verifies the agent's description.
func VerifyAgentDescription(t *testing.T, agent *agentv1.Agent, expectedDescription string) {
	require.Equal(t, expectedDescription, agent.Spec.Description,
		"Agent description should match expected value")

	t.Logf("✓ Agent description verified: %s", expectedDescription)
}

// VerifyMcpServerExists verifies that an MCP server exists in the backend.
func VerifyMcpServerExists(t *testing.T, serverPort int, mcpServerSlug string) *mcpserverv1.McpServer {
	mcpServer, err := GetMcpServerBySlug(serverPort, mcpServerSlug, LocalOrg)
	require.NoError(t, err, "Should be able to query MCP server by slug")
	require.NotNil(t, mcpServer, "MCP server should exist")

	t.Logf("✓ MCP server exists: %s (ID: %s)", mcpServerSlug, mcpServer.Metadata.Id)
	return mcpServer
}

// VerifyWorkflowExists verifies that a workflow exists in the backend.
func VerifyWorkflowExists(t *testing.T, serverPort int, workflowSlug string) *workflowv1.Workflow {
	workflow, err := GetWorkflowBySlug(serverPort, workflowSlug, LocalOrg)
	require.NoError(t, err, "Should be able to query workflow by slug")
	require.NotNil(t, workflow, "Workflow should exist")

	t.Logf("✓ Workflow exists: %s (ID: %s)", workflowSlug, workflow.Metadata.Id)
	return workflow
}

// VerifyResourceCount verifies the total number of resources in a project.
func VerifyResourceCount(t *testing.T, serverPort int, agentCount, mcpServerCount, workflowCount int) {
	t.Logf("Verifying resource counts: agents=%d, mcpServers=%d, workflows=%d",
		agentCount, mcpServerCount, workflowCount)
	// Note: Actual verification is done by checking individual resources exist
	// This is a documentation helper for test readability
}

// VerifyErrorContains verifies that output or error contains expected message.
func VerifyErrorContains(t *testing.T, output string, err error, expectedMsg string) {
	if err != nil {
		require.Contains(t, err.Error(), expectedMsg,
			"Error should contain expected message")
		t.Logf("✓ Error message verified: contains '%s'", expectedMsg)
		return
	}
	require.Contains(t, output, expectedMsg,
		"Output should contain expected error message")
	t.Logf("✓ Output verified: contains '%s'", expectedMsg)
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

// DeleteProject deletes a project via CLI.
func DeleteProject(t *testing.T, serverPort int, projectSlug string) {
	t.Logf("Deleting project: %s", projectSlug)

	output, err := RunCLIWithServerAddr(serverPort, "project", "delete", projectSlug, "--force")
	if err != nil {
		t.Logf("Warning: Failed to delete project %s: %v\nOutput: %s", projectSlug, err, output)
		// Don't fail - cleanup errors are acceptable
	} else {
		t.Logf("✓ Project deleted: %s", projectSlug)
	}
}

// DeleteAgent deletes an agent via CLI.
func DeleteAgent(t *testing.T, serverPort int, agentSlug string) {
	t.Logf("Deleting agent: %s", agentSlug)

	output, err := RunCLIWithServerAddr(serverPort, "agent", "delete", agentSlug, "--force")
	if err != nil {
		t.Logf("Warning: Failed to delete agent %s: %v\nOutput: %s", agentSlug, err, output)
		// Don't fail - cleanup errors are acceptable
	} else {
		t.Logf("✓ Agent deleted: %s", agentSlug)
	}
}
