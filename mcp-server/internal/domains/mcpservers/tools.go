package mcpservers

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// GetMcpServerInput defines the parameters for the "get_mcp_server" tool.
type GetMcpServerInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the MCP server (e.g. acme)."`
	Slug string `json:"slug" jsonschema:"required,description=MCP server slug — the unique identifier within the org (e.g. my-server)."`
}

// Tool returns the MCP tool definition for registration.
func Tool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_mcp_server",
		Description: "Get full details of a Stigmer MCP server by its org and slug (e.g. org=acme slug=my-server).",
	}
}

// Handler returns the typed tool handler. serverAddress is captured at
// registration time; the API key is read from context at call time.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetMcpServerInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetMcpServerInput) (*mcp.CallToolResult, any, error) {
		text, err := Fetch(ctx, serverAddress, input.Org, input.Slug)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
