package mcpservers

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	geninput "github.com/stigmer/stigmer/mcp-server/gen/mcpserver"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// --- get_mcp_server ---

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
		return domains.CallFetch(Fetch, ctx, serverAddress, input.Org, input.Slug)
	}
}

// --- apply_mcp_server ---

// ApplyTool returns the MCP tool definition for the apply_mcp_server tool.
func ApplyTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "apply_mcp_server",
		Description: "Create or update a Stigmer MCP server definition (idempotent). Provide identity fields (name, org) and server configuration (stdio/http, tools, env, etc.).",
	}
}

// ApplyHandler returns the typed tool handler for apply_mcp_server.
// The input is converted to a proto via ToProto() before calling the gRPC Apply RPC.
func ApplyHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *geninput.McpServerInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *geninput.McpServerInput) (*mcp.CallToolResult, any, error) {
		mcpServer := input.ToProto()
		text, err := Apply(ctx, serverAddress, mcpServer)
		if err != nil {
			return nil, nil, err
		}
		return domains.TextResult(text)
	}
}

// --- delete_mcp_server ---

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
		return domains.CallFetch(Delete, ctx, serverAddress, input.Org, input.Slug)
	}
}
