package root

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/organization"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
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
// Organization handler: BuildApplyResult / BuildDryRunResult
// =============================================================================

func TestOrganizationHandler_BuildApplyResult_Created(t *testing.T) {
	h := organization.NewApplyHandler()
	result := newTestOrganizationApplyResult(true)
	cr := h.BuildApplyResult(result.Organization, result.Created)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "Acme Corp")
	requireSectionField(t, cr, "Resource Details", "Slug", "acme-corp")
	requireSectionField(t, cr, "Resource Details", "ID", "org-001")
}

func TestOrganizationHandler_BuildApplyResult_Updated(t *testing.T) {
	h := organization.NewApplyHandler()
	result := newTestOrganizationApplyResult(false)
	cr := h.BuildApplyResult(result.Organization, result.Created)

	assert.Contains(t, cr.Message, "updated")
	assert.NotContains(t, cr.Message, "created")
}

func TestOrganizationHandler_BuildDryRunResult_BasicFields(t *testing.T) {
	h := organization.NewApplyHandler()
	org := &organizationv1.Organization{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Test Org"},
		Spec: &organizationv1.OrganizationSpec{
			Description: "A test organization",
		},
	}
	cr := h.BuildDryRunResult(org)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "Test Org")
	requireSectionField(t, cr, "Organization Preview", "Name", "Test Org")
	requireSectionField(t, cr, "Organization Preview", "Description", "A test organization")
}

func TestOrganizationHandler_BuildDryRunResult_EmptySpec(t *testing.T) {
	h := organization.NewApplyHandler()
	org := &organizationv1.Organization{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Minimal Org"},
		Spec:     &organizationv1.OrganizationSpec{},
	}
	cr := h.BuildDryRunResult(org)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	requireSectionField(t, cr, "Organization Preview", "Name", "Minimal Org")
}

// =============================================================================
// Agent handler: BuildApplyResult / BuildDryRunResult
// =============================================================================

func TestAgentHandler_BuildApplyResult_Created(t *testing.T) {
	h := agent.NewApplyHandler()
	result := newTestAgentApplyResult(true)
	cr := h.BuildApplyResult(result.Agent, result.Created)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "code-reviewer")
	requireSectionField(t, cr, "Resource Details", "Slug", "code-reviewer")
	requireSectionField(t, cr, "Resource Details", "ID", "agt-001")
}

func TestAgentHandler_BuildApplyResult_Updated(t *testing.T) {
	h := agent.NewApplyHandler()
	result := newTestAgentApplyResult(false)
	cr := h.BuildApplyResult(result.Agent, result.Created)

	assert.Contains(t, cr.Message, "updated")
	assert.NotContains(t, cr.Message, "created")
}

func TestAgentHandler_BuildDryRunResult_BasicFields(t *testing.T) {
	h := agent.NewApplyHandler()
	a := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test-agent"},
		Spec: &agentv1.AgentSpec{
			Description:  "A test agent",
			Instructions: "Do things",
		},
	}
	cr := h.BuildDryRunResult(a)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "test-agent")
	requireSectionField(t, cr, "Agent Preview", "Name", "test-agent")
	requireSectionField(t, cr, "Agent Preview", "Description", "A test agent")
}

func TestAgentHandler_BuildDryRunResult_WithMcpServersAndSkills(t *testing.T) {
	h := agent.NewApplyHandler()
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
	cr := h.BuildDryRunResult(a)

	requireSectionField(t, cr, "Agent Preview", "MCP Servers", "2")
	requireSectionField(t, cr, "Agent Preview", "Skills", "1")
	requireSectionField(t, cr, "Agent Preview", "Sub-agents", "1")
}

func TestAgentHandler_BuildDryRunResult_EmptySpec(t *testing.T) {
	h := agent.NewApplyHandler()
	a := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "minimal-agent"},
		Spec:     &agentv1.AgentSpec{},
	}
	cr := h.BuildDryRunResult(a)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	requireSectionField(t, cr, "Agent Preview", "Name", "minimal-agent")
}

// =============================================================================
// Workflow handler: BuildApplyResult / BuildDryRunResult
// =============================================================================

func TestWorkflowHandler_BuildApplyResult_Created(t *testing.T) {
	h := workflow.NewApplyHandler()
	result := newTestWorkflowApplyResult(true)
	cr := h.BuildApplyResult(result.Workflow, result.Created)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "deploy-pipeline")
	requireSectionField(t, cr, "Resource Details", "Slug", "deploy-pipeline")
}

func TestWorkflowHandler_BuildApplyResult_Updated(t *testing.T) {
	h := workflow.NewApplyHandler()
	result := newTestWorkflowApplyResult(false)
	cr := h.BuildApplyResult(result.Workflow, result.Created)

	assert.Contains(t, cr.Message, "updated")
}

func TestWorkflowHandler_BuildDryRunResult_FullSpec(t *testing.T) {
	h := workflow.NewApplyHandler()
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
	cr := h.BuildDryRunResult(wf)

	assert.Contains(t, cr.Message, "deploy")
	requireSectionField(t, cr, "Workflow Preview", "Name", "deploy")
	requireSectionField(t, cr, "Workflow Preview", "Tasks", "2")
	requireSectionField(t, cr, "Workflow Preview", "Version", "2.0.0")
}

func TestWorkflowHandler_BuildDryRunResult_MinimalSpec(t *testing.T) {
	h := workflow.NewApplyHandler()
	wf := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Name: "simple"},
		Spec:     &workflowv1.WorkflowSpec{},
	}
	cr := h.BuildDryRunResult(wf)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	requireSectionField(t, cr, "Workflow Preview", "Name", "simple")
}

// =============================================================================
// MCP Server handler: BuildApplyResult / BuildDryRunResult
// =============================================================================

func TestMcpServerHandler_BuildApplyResult_Created(t *testing.T) {
	h := mcpserver.NewApplyHandler()
	result := newTestMcpServerApplyResult(true)
	cr := h.BuildApplyResult(result.McpServer, result.Created)

	assert.Equal(t, clioutput.StatusSuccess, cr.Status)
	assert.Contains(t, cr.Message, "created")
	requireSectionField(t, cr, "Resource Details", "Name", "github-server")
}

func TestMcpServerHandler_BuildApplyResult_Updated(t *testing.T) {
	h := mcpserver.NewApplyHandler()
	result := newTestMcpServerApplyResult(false)
	cr := h.BuildApplyResult(result.McpServer, result.Created)

	assert.Contains(t, cr.Message, "updated")
}

func TestMcpServerHandler_BuildDryRunResult_StdioType(t *testing.T) {
	h := mcpserver.NewApplyHandler()
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
	cr := h.BuildDryRunResult(mcp)

	requireSectionField(t, cr, "MCP Server Preview", "Type", "stdio")
	requireSectionField(t, cr, "MCP Server Preview", "Command", "npx")
	requireSectionField(t, cr, "MCP Server Preview", "Description", "GitHub server")
}

func TestMcpServerHandler_BuildDryRunResult_HttpType(t *testing.T) {
	h := mcpserver.NewApplyHandler()
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
	cr := h.BuildDryRunResult(mcp)

	requireSectionField(t, cr, "MCP Server Preview", "Type", "http")
	requireSectionField(t, cr, "MCP Server Preview", "URL", "https://mcp.example.com/v1")
}

func TestMcpServerHandler_BuildDryRunResult_WithTags(t *testing.T) {
	h := mcpserver.NewApplyHandler()
	mcp := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "tagged"},
		Spec: &mcpserverv1.McpServerSpec{
			Tags: []string{"cloud", "aws", "infrastructure"},
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{Command: "aws-mcp"},
			},
		},
	}
	cr := h.BuildDryRunResult(mcp)

	found := findSectionField(cr, "MCP Server Preview", "Tags")
	require.NotEmpty(t, found, "Tags field should be present")
	assert.Contains(t, found, "cloud")
}

// =============================================================================
// newApplyHandlerRegistry
// =============================================================================

func TestNewApplyHandlerRegistry_RegistersAllKinds(t *testing.T) {
	reg := newApplyHandlerRegistry()

	expected := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_organization,
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_mcp_server,
	}

	for _, kind := range expected {
		handler, ok := reg.Get(kind)
		assert.True(t, ok, "handler should be registered for %s", kind)
		assert.Equal(t, kind, handler.Kind())
	}
}

func TestNewApplyHandlerRegistry_UnknownKindNotFound(t *testing.T) {
	reg := newApplyHandlerRegistry()

	_, ok := reg.Get(apiresourcekind.ApiResourceKind_skill)
	assert.False(t, ok, "skill should not have an apply handler")
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
