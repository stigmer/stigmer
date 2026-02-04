//go:build e2e
// +build e2e

package e2e

// Project test constants for E2E integration tests.
// These constants define test fixture paths and expected values for Project Track testing.
const (
	// ==========================================================================
	// Test Fixture Directories
	// ==========================================================================

	// ProjectBasicTestDataDir contains a minimal project with 1 agent.
	ProjectBasicTestDataDir = "testdata/project/basic-project"

	// ProjectMultiAgentTestDataDir contains a project with multiple agents,
	// MCP server, and workflow to test dependency ordering.
	ProjectMultiAgentTestDataDir = "testdata/project/multi-agent-project"

	// ProjectUpdateV1TestDataDir contains the initial version of a project for update tests.
	ProjectUpdateV1TestDataDir = "testdata/project/update-project/v1"

	// ProjectUpdateV2TestDataDir contains the updated version with modified agent spec.
	ProjectUpdateV2TestDataDir = "testdata/project/update-project/v2"

	// ProjectOrphanV1TestDataDir contains a project with 3 agents (initial state).
	ProjectOrphanV1TestDataDir = "testdata/project/orphan-project/v1"

	// ProjectOrphanV2TestDataDir contains a project with 2 agents (1 removed = orphan).
	ProjectOrphanV2TestDataDir = "testdata/project/orphan-project/v2"

	// ProjectCircularDepsTestDataDir contains a project with circular dependencies
	// to test error detection.
	ProjectCircularDepsTestDataDir = "testdata/project/circular-deps"

	// ProjectInvalidSDKTestDataDir contains a project with invalid SDK code
	// to test error handling.
	ProjectInvalidSDKTestDataDir = "testdata/project/invalid-sdk"

	// ==========================================================================
	// Project Names/Slugs
	// ==========================================================================

	// BasicProjectName is the slug for the basic project test fixture.
	BasicProjectName = "basic-project"

	// MultiAgentProjectName is the slug for the multi-agent project test fixture.
	MultiAgentProjectName = "multi-agent-orchestrator"

	// UpdateProjectName is the slug for the update project test fixture.
	UpdateProjectName = "update-project"

	// OrphanProjectName is the slug for the orphan pruning test fixture.
	OrphanProjectName = "orphan-project"

	// ==========================================================================
	// Basic Project Expected Values
	// ==========================================================================

	// BasicProjectAgentName is the agent name in the basic project.
	BasicProjectAgentName = "simple-agent"

	// BasicProjectAgentCount is the number of agents in the basic project.
	BasicProjectAgentCount = 1

	// ==========================================================================
	// Multi-Agent Project Expected Values
	// ==========================================================================

	// MultiAgentProjectAgentCount is the number of agents in the multi-agent project.
	MultiAgentProjectAgentCount = 3

	// MultiAgentProjectMcpServerCount is the number of MCP servers in the multi-agent project.
	MultiAgentProjectMcpServerCount = 1

	// MultiAgentProjectWorkflowCount is the number of workflows in the multi-agent project.
	MultiAgentProjectWorkflowCount = 1

	// Agent names in multi-agent project
	MultiAgentETLAgentName       = "etl-agent"
	MultiAgentValidatorAgentName = "validator-agent"
	MultiAgentReporterAgentName  = "reporter-agent"

	// MCP Server name in multi-agent project
	MultiAgentMcpServerName = "data-source-mcp"

	// Workflow name in multi-agent project
	MultiAgentWorkflowName = "data-pipeline"

	// ==========================================================================
	// Update Project Expected Values
	// ==========================================================================

	// UpdateProjectAgentName is the agent name in the update project.
	UpdateProjectAgentName = "updatable-agent"

	// UpdateProjectV1Description is the initial description.
	UpdateProjectV1Description = "Initial agent description"

	// UpdateProjectV2Description is the updated description.
	UpdateProjectV2Description = "Updated agent description with new features"

	// ==========================================================================
	// Orphan Project Expected Values
	// ==========================================================================

	// OrphanProjectV1AgentCount is the agent count in v1 (before orphan pruning).
	OrphanProjectV1AgentCount = 3

	// OrphanProjectV2AgentCount is the agent count in v2 (after 1 removed).
	OrphanProjectV2AgentCount = 2

	// OrphanAgentName is the name of the agent that gets removed (orphaned).
	OrphanAgentName = "orphan-agent"

	// ==========================================================================
	// Timeouts
	// ==========================================================================

	// ProjectApplyTimeoutSeconds is the timeout for project apply operations.
	ProjectApplyTimeoutSeconds = 60
)
