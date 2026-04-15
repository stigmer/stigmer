package agent

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// =============================================================================
// Test Helpers
// =============================================================================

func newMcpServerRef(org, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Org:  org,
		Slug: slug,
	}
}

func newMcpServerUsage(org, slug string, tools ...string) *agentv1.McpServerUsage {
	return &agentv1.McpServerUsage{
		McpServerRef: newMcpServerRef(org, slug),
		EnabledTools: tools,
	}
}

func newSubAgent(name string, mcpAccess ...*agentv1.McpAccess) *agentv1.SubAgent {
	return &agentv1.SubAgent{
		Name:         name,
		Instructions: "Test instructions for sub-agent.",
		McpAccess:    mcpAccess,
	}
}

func newMcpAccess(mcpServer string, tools ...string) *agentv1.McpAccess {
	return &agentv1.McpAccess{
		McpServer:    mcpServer,
		EnabledTools: tools,
	}
}

// =============================================================================
// Validate Tests
// =============================================================================

func TestValidate_NilAgent(t *testing.T) {
	err := Validate(nil)
	assert.NoError(t, err, "nil agent should pass validation")
}

func TestValidate_NilSpec(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
	}
	err := Validate(agent)
	assert.NoError(t, err, "nil spec should pass validation")
}

func TestValidate_EmptySpec(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec:       &agentv1.AgentSpec{},
	}
	err := Validate(agent)
	assert.NoError(t, err, "empty spec should pass validation")
}

func TestValidate_ValidAgentWithMcpServers(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github", "search_code", "get_file"),
				newMcpServerUsage("stigmer", "slack", "send_message"),
			},
		},
	}
	err := Validate(agent)
	assert.NoError(t, err, "valid agent with unique MCP servers should pass")
}

func TestValidate_ValidAgentWithSubAgents(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github", "search_code", "get_file", "create_pr"),
			},
			SubAgents: []*agentv1.SubAgent{
				newSubAgent("code-reviewer",
					newMcpAccess("github", "search_code", "get_file"),
				),
			},
		},
	}
	err := Validate(agent)
	assert.NoError(t, err, "valid agent with sub-agent using subset of parent tools should pass")
}

// =============================================================================
// Unique MCP Server Usage Tests
// =============================================================================

func TestValidate_DuplicateMcpServerUsage(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github", "search_code"),
				newMcpServerUsage("stigmer", "github", "create_pr"), // Duplicate!
			},
		},
	}

	err := Validate(agent)
	require.Error(t, err, "duplicate MCP server usage should fail")
	assert.Contains(t, err.Error(), "duplicate MCP server reference")
	assert.Contains(t, err.Error(), "github")
}

func TestValidate_SameSlugDifferentOrg(t *testing.T) {
	// Same slug but different org should be allowed
	// (the slug is the identifier, org is part of the reference)
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github"),
				newMcpServerUsage("acme", "github"), // Same slug, different org - still duplicate!
			},
		},
	}

	// Note: Current implementation considers slug alone for uniqueness
	// This is by design - the slug is the identifier used in SubAgent.mcp_access
	err := Validate(agent)
	require.Error(t, err, "same slug should be considered duplicate regardless of org")
}

// =============================================================================
// SubAgent MCP Access Tests
// =============================================================================

func TestValidate_SubAgentReferencesUndefinedMcpServer(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github"),
			},
			SubAgents: []*agentv1.SubAgent{
				newSubAgent("researcher",
					newMcpAccess("slack"), // Not in parent's mcp_server_usages!
				),
			},
		},
	}

	err := Validate(agent)
	require.Error(t, err, "sub-agent referencing undefined MCP server should fail")
	assert.Contains(t, err.Error(), "undefined MCP server")
	assert.Contains(t, err.Error(), "slack")
	assert.Contains(t, err.Error(), "researcher")
}

func TestValidate_SubAgentToolsNotInParent(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github", "search_code", "get_file"),
			},
			SubAgents: []*agentv1.SubAgent{
				newSubAgent("deployer",
					newMcpAccess("github", "search_code", "delete_repo"), // delete_repo not in parent!
				),
			},
		},
	}

	err := Validate(agent)
	require.Error(t, err, "sub-agent using tool not in parent should fail")
	assert.Contains(t, err.Error(), "delete_repo")
	assert.Contains(t, err.Error(), "not enabled")
}

func TestValidate_SubAgentEmptyToolsInheritsParent(t *testing.T) {
	// Empty enabled_tools on sub-agent means "inherit all parent tools"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github", "search_code", "get_file"),
			},
			SubAgents: []*agentv1.SubAgent{
				newSubAgent("researcher",
					newMcpAccess("github"), // No tools = all parent tools
				),
			},
		},
	}

	err := Validate(agent)
	assert.NoError(t, err, "sub-agent with empty tools should inherit parent tools")
}

func TestValidate_ParentEmptyToolsAllowsAnySubAgentTools(t *testing.T) {
	// Empty enabled_tools on parent means "all tools available"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github"), // No tools = all available
			},
			SubAgents: []*agentv1.SubAgent{
				newSubAgent("power-user",
					newMcpAccess("github", "any_tool", "another_tool"),
				),
			},
		},
	}

	err := Validate(agent)
	assert.NoError(t, err, "parent with empty tools should allow any sub-agent tools")
}

func TestValidate_MultipleSubAgentsWithValidAccess(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github", "search_code", "get_file", "create_pr"),
				newMcpServerUsage("stigmer", "slack", "send_message", "read_channel"),
			},
			SubAgents: []*agentv1.SubAgent{
				newSubAgent("code-reviewer",
					newMcpAccess("github", "search_code", "get_file"),
				),
				newSubAgent("notifier",
					newMcpAccess("slack", "send_message"),
				),
				newSubAgent("full-access",
					newMcpAccess("github"),
					newMcpAccess("slack"),
				),
			},
		},
	}

	err := Validate(agent)
	assert.NoError(t, err, "multiple sub-agents with valid access should pass")
}

func TestValidate_SubAgentWithNoMcpAccess(t *testing.T) {
	// Sub-agent with no mcp_access is valid (uses no MCP servers)
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a helpful assistant.",
			McpServerUsages: []*agentv1.McpServerUsage{
				newMcpServerUsage("stigmer", "github"),
			},
			SubAgents: []*agentv1.SubAgent{
				newSubAgent("thinker"), // No mcp_access
			},
		},
	}

	err := Validate(agent)
	assert.NoError(t, err, "sub-agent with no mcp_access should pass")
}

// =============================================================================
// Error Message Quality Tests
// =============================================================================

func TestValidate_ErrorMessageIncludesGuidance(t *testing.T) {
	tests := []struct {
		name           string
		agent          *agentv1.Agent
		wantContains   []string
		wantErrPattern string
	}{
		{
			name: "duplicate_mcp_server_provides_fix",
			agent: &agentv1.Agent{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "Agent",
				Spec: &agentv1.AgentSpec{
					Instructions: "Test.",
					McpServerUsages: []*agentv1.McpServerUsage{
						newMcpServerUsage("org", "dup"),
						newMcpServerUsage("org", "dup"),
					},
				},
			},
			wantContains: []string{"duplicate", "dup", "Remove"},
		},
		{
			name: "undefined_mcp_server_provides_fix",
			agent: &agentv1.Agent{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "Agent",
				Spec: &agentv1.AgentSpec{
					Instructions: "Test.",
					SubAgents: []*agentv1.SubAgent{
						newSubAgent("test", newMcpAccess("missing")),
					},
				},
			},
			wantContains: []string{"undefined", "missing", "Add"},
		},
		{
			name: "tool_not_enabled_provides_fix",
			agent: &agentv1.Agent{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "Agent",
				Spec: &agentv1.AgentSpec{
					Instructions: "Test.",
					McpServerUsages: []*agentv1.McpServerUsage{
						newMcpServerUsage("org", "srv", "tool1"),
					},
					SubAgents: []*agentv1.SubAgent{
						newSubAgent("test", newMcpAccess("srv", "tool2")),
					},
				},
			},
			wantContains: []string{"tool2", "not enabled", "Either add"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Validate(tt.agent)
			require.Error(t, err)

			errMsg := err.Error()
			for _, want := range tt.wantContains {
				assert.True(t,
					strings.Contains(errMsg, want),
					"error message should contain %q, got: %s", want, errMsg,
				)
			}
		})
	}
}
