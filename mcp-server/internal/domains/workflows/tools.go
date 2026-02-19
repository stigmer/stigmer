// Package workflows provides the "get_workflow" MCP tool backed by the
// WorkflowQueryController.getByReference RPC.
package workflows

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

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

// Handler returns the typed tool handler.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetWorkflowInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetWorkflowInput) (*mcp.CallToolResult, any, error) {
		text, err := Fetch(ctx, serverAddress, input.Org, input.Slug)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
