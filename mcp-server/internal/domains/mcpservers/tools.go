package mcpservers

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

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
		return domains.CallApply(Apply, ctx, serverAddress, input.Resource)
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
