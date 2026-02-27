package root

import (
	"fmt"

	"github.com/pkg/errors"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// buildResourceReference creates an ApiResourceReference from resource metadata and kind.
func buildResourceReference(
	metadata *apiresource.ApiResourceMetadata,
	kind apiresourcekind.ApiResourceKind,
) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  metadata.Org,
		Kind: kind,
		Slug: metadata.Slug,
	}
}

func applyAgent(item applyItem, fctx *fileApplyContext) (*apiresource.ApiResourceReference, error) {
	loadResult, err := agent.LoadFromBytes(item.rawContent)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load agent")
	}
	if err := agent.Validate(loadResult.Agent); err != nil {
		return nil, errors.Wrap(err, "agent validation failed")
	}

	if fctx.dryRun {
		fctx.renderer.Render(buildAgentDryRunResult(loadResult.Agent))
		return nil, nil
	}

	result, err := agent.Apply(&agent.ApplyOptions{
		Agent:  loadResult.Agent,
		OrgID:  fctx.orgID,
		Conn:   fctx.conn,
		Quiet:  false,
		DryRun: false,
	})
	if err != nil {
		return nil, err
	}

	fctx.renderer.Render(buildAgentApplyResult(result))
	return buildResourceReference(result.Agent.Metadata, apiresourcekind.ApiResourceKind_agent), nil
}

func applyWorkflow(item applyItem, fctx *fileApplyContext) (*apiresource.ApiResourceReference, error) {
	loadResult, err := workflow.LoadFromBytes(item.rawContent)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load workflow")
	}
	if err := workflow.Validate(loadResult.Workflow); err != nil {
		return nil, errors.Wrap(err, "workflow validation failed")
	}

	if fctx.dryRun {
		fctx.renderer.Render(buildWorkflowDryRunResult(loadResult.Workflow))
		return nil, nil
	}

	result, err := workflow.Apply(&workflow.ApplyOptions{
		Workflow: loadResult.Workflow,
		OrgID:    fctx.orgID,
		Conn:     fctx.conn,
		Quiet:    false,
		DryRun:   false,
	})
	if err != nil {
		return nil, err
	}

	fctx.renderer.Render(buildWorkflowApplyResult(result))
	return buildResourceReference(result.Workflow.Metadata, apiresourcekind.ApiResourceKind_workflow), nil
}

func applyMcpServer(item applyItem, fctx *fileApplyContext) (*apiresource.ApiResourceReference, error) {
	loadResult, err := mcpserver.LoadFromBytes(item.rawContent)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load MCP server")
	}

	if fctx.dryRun {
		fctx.renderer.Render(buildMcpServerDryRunResult(loadResult.McpServer))
		return nil, nil
	}

	result, err := mcpserver.Apply(&mcpserver.ApplyOptions{
		McpServer: loadResult.McpServer,
		OrgID:     fctx.orgID,
		Conn:      fctx.conn,
		Quiet:     false,
		DryRun:    false,
	})
	if err != nil {
		return nil, err
	}

	fctx.renderer.Render(buildMcpServerApplyResult(result))
	return buildResourceReference(result.McpServer.Metadata, apiresourcekind.ApiResourceKind_mcp_server), nil
}

func buildAgentApplyResult(result *agent.ApplyResult) *clioutput.CommandResult {
	action := "updated"
	if result.Created {
		action = "created"
	}
	out := clioutput.Success("Agent %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", result.Agent.Metadata.Id).
		Field("Name", result.Agent.Metadata.Name).
		Field("Slug", result.Agent.Metadata.Slug)
	out.Hintf("View details: stigmer get agent %s", result.Agent.Metadata.Slug)
	out.Hintf("Run agent:    stigmer run agent %s", result.Agent.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete agent %s", result.Agent.Metadata.Slug)
	return out
}

func buildAgentDryRunResult(a *agentv1.Agent) *clioutput.CommandResult {
	out := clioutput.Success("Dry run: %s is valid", a.Metadata.Name)
	sec := out.AddSection("Agent Preview")
	sec.Field("Name", a.Metadata.Name)
	if a.Spec != nil {
		if a.Spec.Description != "" {
			sec.Field("Description", a.Spec.Description)
		}
		if a.Spec.Instructions != "" {
			sec.Field("Instructions", truncateForDisplay(a.Spec.Instructions, 80))
		}
		if len(a.Spec.McpServerUsages) > 0 {
			sec.Fieldf("MCP Servers", "%d", len(a.Spec.McpServerUsages))
		}
		if len(a.Spec.SkillRefs) > 0 {
			sec.Fieldf("Skills", "%d", len(a.Spec.SkillRefs))
		}
		if len(a.Spec.SubAgents) > 0 {
			sec.Fieldf("Sub-agents", "%d", len(a.Spec.SubAgents))
		}
	}
	return out
}

func buildWorkflowApplyResult(result *workflow.ApplyResult) *clioutput.CommandResult {
	action := "updated"
	if result.Created {
		action = "created"
	}
	out := clioutput.Success("Workflow %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", result.Workflow.Metadata.Id).
		Field("Name", result.Workflow.Metadata.Name).
		Field("Slug", result.Workflow.Metadata.Slug)
	out.Hintf("View details: stigmer get workflow %s", result.Workflow.Metadata.Slug)
	out.Hintf("Run workflow: stigmer run workflow %s", result.Workflow.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete workflow %s", result.Workflow.Metadata.Slug)
	return out
}

func buildWorkflowDryRunResult(wf *workflowv1.Workflow) *clioutput.CommandResult {
	out := clioutput.Success("Dry run: %s is valid", wf.Metadata.Name)
	sec := out.AddSection("Workflow Preview")
	sec.Field("Name", wf.Metadata.Name)
	if wf.Spec != nil {
		if wf.Spec.Description != "" {
			sec.Field("Description", truncateForDisplay(wf.Spec.Description, 80))
		}
		if len(wf.Spec.Tasks) > 0 {
			sec.Fieldf("Tasks", "%d", len(wf.Spec.Tasks))
		}
		if wf.Spec.Document != nil && wf.Spec.Document.Version != "" {
			sec.Field("Version", wf.Spec.Document.Version)
		}
	}
	return out
}

func buildMcpServerApplyResult(result *mcpserver.ApplyResult) *clioutput.CommandResult {
	action := "updated"
	if result.Created {
		action = "created"
	}
	out := clioutput.Success("MCP server %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", result.McpServer.Metadata.Id).
		Field("Name", result.McpServer.Metadata.Name).
		Field("Slug", result.McpServer.Metadata.Slug)
	out.Hintf("View details: stigmer get mcpserver %s", result.McpServer.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete mcpserver %s", result.McpServer.Metadata.Slug)
	return out
}

func buildMcpServerDryRunResult(mcp *mcpserverv1.McpServer) *clioutput.CommandResult {
	out := clioutput.Success("Dry run: %s is valid", mcp.Metadata.Name)
	sec := out.AddSection("MCP Server Preview")
	sec.Field("Name", mcp.Metadata.Name)
	if mcp.Spec.Description != "" {
		sec.Field("Description", mcp.Spec.Description)
	}
	if stdio := mcp.Spec.GetStdio(); stdio != nil {
		sec.Field("Type", "stdio")
		sec.Field("Command", stdio.Command)
		if len(stdio.Args) > 0 {
			sec.Field("Args", fmt.Sprintf("%v", stdio.Args))
		}
	} else if http := mcp.Spec.GetHttp(); http != nil {
		sec.Field("Type", "http")
		sec.Field("URL", http.Url)
	}
	if len(mcp.Spec.Tags) > 0 {
		sec.Field("Tags", fmt.Sprintf("%v", mcp.Spec.Tags))
	}
	return out
}

func truncateForDisplay(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
}
