package workflows

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

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
		text, err := Delete(ctx, serverAddress, input.Org, input.Slug)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
