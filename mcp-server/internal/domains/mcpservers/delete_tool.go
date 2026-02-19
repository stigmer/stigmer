package mcpservers

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// DeleteMcpServerInput defines the parameters for the "delete_mcp_server" tool.
type DeleteMcpServerInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the MCP server (e.g. acme)."`
	Slug string `json:"slug" jsonschema:"required,description=MCP server slug — the unique identifier within the org (e.g. github)."`
}

// DeleteTool returns the MCP tool definition for the delete_mcp_server tool.
func DeleteTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "delete_mcp_server",
		Description: "Delete a Stigmer MCP server definition by its org and slug. Returns the deleted MCP server.",
	}
}

// DeleteHandler returns the typed tool handler for delete_mcp_server.
func DeleteHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *DeleteMcpServerInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *DeleteMcpServerInput) (*mcp.CallToolResult, any, error) {
		text, err := Delete(ctx, serverAddress, input.Org, input.Slug)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
