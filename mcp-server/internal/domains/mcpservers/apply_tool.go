package mcpservers

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ApplyMcpServerInput defines the parameters for the "apply_mcp_server" tool.
type ApplyMcpServerInput struct {
	Resource string `json:"resource" jsonschema:"required,description=Full MCP server resource as JSON. Must include api_version (agentic.stigmer.ai/v1)\\, kind (McpServer)\\, metadata (org\\, slug\\, name required)\\, and spec with server_type (stdio or http config). Example: {\"api_version\":\"agentic.stigmer.ai/v1\"\\,\"kind\":\"McpServer\"\\,\"metadata\":{\"org\":\"acme\"\\,\"slug\":\"github\"\\,\"name\":\"GitHub\"}\\,\"spec\":{\"description\":\"GitHub MCP server\"\\,\"stdio\":{\"command\":\"npx\"\\,\"args\":[\"-y\"\\,\"@modelcontextprotocol/server-github\"]}}}"`
}

// ApplyTool returns the MCP tool definition for the apply_mcp_server tool.
func ApplyTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "apply_mcp_server",
		Description: "Create or update a Stigmer MCP server definition (idempotent). Provide the full MCP server resource as JSON.",
	}
}

// ApplyHandler returns the typed tool handler for apply_mcp_server.
func ApplyHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *ApplyMcpServerInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *ApplyMcpServerInput) (*mcp.CallToolResult, any, error) {
		text, err := Apply(ctx, serverAddress, input.Resource)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
