package root

import (
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// buildResourceReference
// =============================================================================

func TestBuildResourceReference_PopulatesFields(t *testing.T) {
	meta := &apiresource.ApiResourceMetadata{
		Org:  "acme-corp",
		Slug: "my-agent",
	}
	ref := buildResourceReference(meta, apiresourcekind.ApiResourceKind_agent)

	assert.Equal(t, "acme-corp", ref.Org)
	assert.Equal(t, apiresourcekind.ApiResourceKind_agent, ref.Kind)
	assert.Equal(t, "my-agent", ref.Slug)
}

func TestBuildResourceReference_WorkflowKind(t *testing.T) {
	meta := &apiresource.ApiResourceMetadata{
		Org:  "test-org",
		Slug: "deploy-pipeline",
	}
	ref := buildResourceReference(meta, apiresourcekind.ApiResourceKind_workflow)

	assert.Equal(t, apiresourcekind.ApiResourceKind_workflow, ref.Kind)
	assert.Equal(t, "deploy-pipeline", ref.Slug)
}

func TestBuildResourceReference_McpServerKind(t *testing.T) {
	meta := &apiresource.ApiResourceMetadata{
		Org:  "test-org",
		Slug: "github-mcp",
	}
	ref := buildResourceReference(meta, apiresourcekind.ApiResourceKind_mcp_server)

	assert.Equal(t, apiresourcekind.ApiResourceKind_mcp_server, ref.Kind)
	assert.Equal(t, "github-mcp", ref.Slug)
}

// =============================================================================
// buildOrganizationApplyResult
// =============================================================================

func TestBuildOrganizationApplyResult_Created(t *testing.T) {
	result := newTestOrganizationApplyResult(true)
	cr := buildOrganizationApplyResult(result)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "Acme Corp")
	requireSectionField(t, cr, "Resource Details", "Slug", "acme-corp")
	requireSectionField(t, cr, "Resource Details", "ID", "org-001")
}

func TestBuildOrganizationApplyResult_Updated(t *testing.T) {
	result := newTestOrganizationApplyResult(false)
	cr := buildOrganizationApplyResult(result)

	assert.Contains(t, cr.Message, "updated")
	assert.NotContains(t, cr.Message, "created")
}

// =============================================================================
// buildOrganizationDryRunResult
// =============================================================================

func TestBuildOrganizationDryRunResult_BasicFields(t *testing.T) {
	org := &organizationv1.Organization{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Test Org"},
		Spec: &organizationv1.OrganizationSpec{
			Description: "A test organization",
		},
	}
	cr := buildOrganizationDryRunResult(org)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "Test Org")
	requireSectionField(t, cr, "Organization Preview", "Name", "Test Org")
	requireSectionField(t, cr, "Organization Preview", "Description", "A test organization")
}

func TestBuildOrganizationDryRunResult_EmptySpec(t *testing.T) {
	org := &organizationv1.Organization{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Minimal Org"},
		Spec:     &organizationv1.OrganizationSpec{},
	}
	cr := buildOrganizationDryRunResult(org)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	requireSectionField(t, cr, "Organization Preview", "Name", "Minimal Org")
}

// =============================================================================
// truncateForDisplay
// =============================================================================

func TestTruncateForDisplay_WithinLimit(t *testing.T) {
	assert.Equal(t, "short", truncateForDisplay("short", 100))
}

func TestTruncateForDisplay_AtExactLimit(t *testing.T) {
	s := "12345"
	assert.Equal(t, "12345", truncateForDisplay(s, 5))
}

func TestTruncateForDisplay_OverLimit(t *testing.T) {
	s := "This is a long string that exceeds the limit"
	result := truncateForDisplay(s, 20)
	assert.Equal(t, 20, len(result))
	assert.True(t, strings.HasSuffix(result, "..."))
}

func TestTruncateForDisplay_MaxLenThreeOrLess(t *testing.T) {
	assert.Equal(t, "...", truncateForDisplay("hello", 3))
	assert.Equal(t, "...", truncateForDisplay("hello", 2))
	assert.Equal(t, "...", truncateForDisplay("hello", 1))
}

func TestTruncateForDisplay_EmptyString(t *testing.T) {
	assert.Equal(t, "", truncateForDisplay("", 10))
}

// =============================================================================
// buildAgentApplyResult
// =============================================================================

func TestBuildAgentApplyResult_Created(t *testing.T) {
	result := newTestAgentApplyResult(true)
	cr := buildAgentApplyResult(result)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "code-reviewer")
	requireSectionField(t, cr, "Resource Details", "Slug", "code-reviewer")
	requireSectionField(t, cr, "Resource Details", "ID", "agt-001")
}

func TestBuildAgentApplyResult_Updated(t *testing.T) {
	result := newTestAgentApplyResult(false)
	cr := buildAgentApplyResult(result)

	assert.Contains(t, cr.Message, "updated")
	assert.NotContains(t, cr.Message, "created")
}

// =============================================================================
// buildAgentDryRunResult
// =============================================================================

func TestBuildAgentDryRunResult_BasicFields(t *testing.T) {
	a := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test-agent"},
		Spec: &agentv1.AgentSpec{
			Description:  "A test agent",
			Instructions: "Do things",
		},
	}
	cr := buildAgentDryRunResult(a)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "test-agent")
	requireSectionField(t, cr, "Agent Preview", "Name", "test-agent")
	requireSectionField(t, cr, "Agent Preview", "Description", "A test agent")
}

func TestBuildAgentDryRunResult_WithMcpServersAndSkills(t *testing.T) {
	a := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "rich-agent"},
		Spec: &agentv1.AgentSpec{
			McpServerUsages: []*agentv1.McpServerUsage{
				{McpServerRef: &apiresource.ApiResourceReference{Slug: "github"}},
				{McpServerRef: &apiresource.ApiResourceReference{Slug: "jira"}},
			},
			SkillRefs: []*apiresource.ApiResourceReference{
				{Slug: "web-search"},
			},
			SubAgents: []*agentv1.SubAgent{
				{Name: "researcher"},
			},
		},
	}
	cr := buildAgentDryRunResult(a)

	requireSectionField(t, cr, "Agent Preview", "MCP Servers", "2")
	requireSectionField(t, cr, "Agent Preview", "Skills", "1")
	requireSectionField(t, cr, "Agent Preview", "Sub-agents", "1")
}

func TestBuildAgentDryRunResult_EmptySpec(t *testing.T) {
	a := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "minimal-agent"},
		Spec:     &agentv1.AgentSpec{},
	}
	cr := buildAgentDryRunResult(a)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	requireSectionField(t, cr, "Agent Preview", "Name", "minimal-agent")
}

// =============================================================================
// buildWorkflowApplyResult
// =============================================================================

func TestBuildWorkflowApplyResult_Created(t *testing.T) {
	result := newTestWorkflowApplyResult(true)
	cr := buildWorkflowApplyResult(result)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "deploy-pipeline")
	requireSectionField(t, cr, "Resource Details", "Slug", "deploy-pipeline")
}

func TestBuildWorkflowApplyResult_Updated(t *testing.T) {
	result := newTestWorkflowApplyResult(false)
	cr := buildWorkflowApplyResult(result)

	assert.Contains(t, cr.Message, "updated")
}

// =============================================================================
// buildWorkflowDryRunResult
// =============================================================================

func TestBuildWorkflowDryRunResult_FullSpec(t *testing.T) {
	wf := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Name: "deploy"},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Deploy workflow",
			Tasks: []*workflowv1.WorkflowTask{
				{Name: "build"},
				{Name: "test"},
			},
			Document: &workflowv1.WorkflowDocument{Version: "2.0.0"},
		},
	}
	cr := buildWorkflowDryRunResult(wf)

	assert.Contains(t, cr.Message, "deploy")
	requireSectionField(t, cr, "Workflow Preview", "Name", "deploy")
	requireSectionField(t, cr, "Workflow Preview", "Tasks", "2")
	requireSectionField(t, cr, "Workflow Preview", "Version", "2.0.0")
}

func TestBuildWorkflowDryRunResult_MinimalSpec(t *testing.T) {
	wf := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Name: "simple"},
		Spec:     &workflowv1.WorkflowSpec{},
	}
	cr := buildWorkflowDryRunResult(wf)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	requireSectionField(t, cr, "Workflow Preview", "Name", "simple")
}

// =============================================================================
// buildMcpServerApplyResult
// =============================================================================

func TestBuildMcpServerApplyResult_Created(t *testing.T) {
	result := newTestMcpServerApplyResult(true)
	cr := buildMcpServerApplyResult(result)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "github-server")
}

func TestBuildMcpServerApplyResult_Updated(t *testing.T) {
	result := newTestMcpServerApplyResult(false)
	cr := buildMcpServerApplyResult(result)

	assert.Contains(t, cr.Message, "updated")
}

// =============================================================================
// buildMcpServerDryRunResult
// =============================================================================

func TestBuildMcpServerDryRunResult_StdioType(t *testing.T) {
	mcp := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "github"},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "GitHub server",
			Tags:        []string{"git", "vcs"},
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "npx",
					Args:    []string{"-y", "@mcp/server-github"},
				},
			},
		},
	}
	cr := buildMcpServerDryRunResult(mcp)

	requireSectionField(t, cr, "MCP Server Preview", "Type", "stdio")
	requireSectionField(t, cr, "MCP Server Preview", "Command", "npx")
	requireSectionField(t, cr, "MCP Server Preview", "Description", "GitHub server")
}

func TestBuildMcpServerDryRunResult_HttpType(t *testing.T) {
	mcp := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "remote-mcp"},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: "https://mcp.example.com/v1",
				},
			},
		},
	}
	cr := buildMcpServerDryRunResult(mcp)

	requireSectionField(t, cr, "MCP Server Preview", "Type", "http")
	requireSectionField(t, cr, "MCP Server Preview", "URL", "https://mcp.example.com/v1")
}

func TestBuildMcpServerDryRunResult_WithTags(t *testing.T) {
	mcp := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "tagged"},
		Spec: &mcpserverv1.McpServerSpec{
			Tags: []string{"cloud", "aws", "infrastructure"},
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{Command: "aws-mcp"},
			},
		},
	}
	cr := buildMcpServerDryRunResult(mcp)

	found := findSectionField(cr, "MCP Server Preview", "Tags")
	require.NotEmpty(t, found, "Tags field should be present")
	assert.Contains(t, found, "cloud")
}

// =============================================================================
// Assertion Helpers
// =============================================================================

func requireSectionField(t *testing.T, cr *clioutput.CommandResult, sectionTitle, key, expectedValue string) {
	t.Helper()
	value := findSectionField(cr, sectionTitle, key)
	require.NotEmpty(t, value, "field %q not found in section %q", key, sectionTitle)
	assert.Contains(t, value, expectedValue, "field %q in section %q", key, sectionTitle)
}

func findSectionField(cr *clioutput.CommandResult, sectionTitle, key string) string {
	for _, sec := range cr.Sections {
		if sec.Title != sectionTitle {
			continue
		}
		for _, kv := range sec.Fields {
			if kv.Key == key {
				return kv.Value
			}
		}
	}
	return ""
}
