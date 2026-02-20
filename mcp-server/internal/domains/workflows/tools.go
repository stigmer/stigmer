// Package workflows provides the MCP tools and resource template for the
// Workflow domain, backed by the WorkflowQueryController and
// WorkflowCommandController RPCs.
package workflows

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// --- get_workflow ---

// GetWorkflowInput defines the parameters for the "get_workflow" tool.
type GetWorkflowInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the workflow."`
	Slug string `json:"slug" jsonschema:"required,description=Workflow slug — unique identifier within the org."`
}

// Tool returns the MCP tool definition for registration.
func Tool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_workflow",
		Description: "Get full details of a Stigmer workflow by its org and slug.",
	}
}

// Handler returns the typed tool handler. serverAddress is captured at
// registration time; the API key is read from context at call time.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetWorkflowInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetWorkflowInput) (*mcp.CallToolResult, any, error) {
		return domains.CallFetch(Fetch, ctx, serverAddress, input.Org, input.Slug)
	}
}

// --- apply_workflow ---

// ApplyWorkflowInput defines the parameters for the "apply_workflow" tool.
type ApplyWorkflowInput struct {
	Resource string `json:"resource" jsonschema:"required,description=Full workflow resource as JSON. Must include api_version (agentic.stigmer.ai/v1)\\, kind (Workflow)\\, metadata (org\\, slug\\, name required)\\, and spec (document and tasks required). The spec.document must include dsl\\, namespace\\, name\\, and version. Tasks is a list with at least one entry."`
}

// ApplyTool returns the MCP tool definition for the apply_workflow tool.
func ApplyTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "apply_workflow",
		Description: "Create or update a Stigmer workflow (idempotent). Provide the full workflow resource as JSON.",
	}
}

// ApplyHandler returns the typed tool handler for apply_workflow.
func ApplyHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *ApplyWorkflowInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *ApplyWorkflowInput) (*mcp.CallToolResult, any, error) {
		return domains.CallApply(Apply, ctx, serverAddress, input.Resource)
	}
}

// --- delete_workflow ---

// DeleteWorkflowInput defines the parameters for the "delete_workflow" tool.
type DeleteWorkflowInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the workflow."`
	Slug string `json:"slug" jsonschema:"required,description=Workflow slug — unique identifier within the org."`
}

// DeleteTool returns the MCP tool definition for the delete_workflow tool.
func DeleteTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "delete_workflow",
		Description: "Delete a Stigmer workflow by its org and slug. Returns the deleted workflow.",
	}
}

// DeleteHandler returns the typed tool handler for delete_workflow.
func DeleteHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *DeleteWorkflowInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *DeleteWorkflowInput) (*mcp.CallToolResult, any, error) {
		return domains.CallFetch(Delete, ctx, serverAddress, input.Org, input.Slug)
	}
}
