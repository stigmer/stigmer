// Package workflows provides the MCP tools and resource template for the
// Workflow domain, backed by the WorkflowQueryController and
// WorkflowCommandController RPCs.
package workflows

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	geninput "github.com/stigmer/stigmer/mcp-server/gen/agentic/workflow"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// --- get_workflow ---

// GetWorkflowInput defines the parameters for the "get_workflow" tool.
type GetWorkflowInput struct {
	Org  string `json:"org"  jsonschema:"Organization slug that owns the workflow."`
	Slug string `json:"slug" jsonschema:"Workflow slug — unique identifier within the org."`
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

// ApplyTool returns the MCP tool definition for the apply_workflow tool.
func ApplyTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "apply_workflow",
		Description: "Create or update a Stigmer workflow (idempotent). Provide identity fields (name, org) and workflow configuration (document, tasks, env, etc.).",
	}
}

// ApplyHandler returns the typed tool handler for apply_workflow.
// The input is converted to a proto via ToProto() before calling the gRPC Apply RPC.
func ApplyHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *geninput.WorkflowInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *geninput.WorkflowInput) (*mcp.CallToolResult, any, error) {
		workflow, err := input.ToProto()
		if err != nil {
			return nil, nil, err
		}
		text, err := Apply(ctx, serverAddress, workflow)
		if err != nil {
			return nil, nil, err
		}
		return domains.TextResult(text)
	}
}

// --- delete_workflow ---

// DeleteWorkflowInput defines the parameters for the "delete_workflow" tool.
type DeleteWorkflowInput struct {
	Org  string `json:"org"  jsonschema:"Organization slug that owns the workflow."`
	Slug string `json:"slug" jsonschema:"Workflow slug — unique identifier within the org."`
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
