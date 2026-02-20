// Package agents provides the MCP tools and resource template for the Agent
// domain, backed by the AgentQueryController and AgentCommandController RPCs.
package agents

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// --- get_agent ---

// GetAgentInput defines the parameters for the "get_agent" tool.
type GetAgentInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the agent (e.g. stigmer)."`
	Slug string `json:"slug" jsonschema:"required,description=Agent slug — the unique identifier within the org (e.g. code-reviewer)."`
}

// Tool returns the MCP tool definition for registration.
func Tool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_agent",
		Description: "Get full details of a Stigmer agent by its org and slug (e.g. org=stigmer slug=code-reviewer).",
	}
}

// Handler returns the typed tool handler. serverAddress is captured at
// registration time; the API key is read from context at call time.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetAgentInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetAgentInput) (*mcp.CallToolResult, any, error) {
		return domains.CallFetch(Fetch, ctx, serverAddress, input.Org, input.Slug)
	}
}

// --- apply_agent ---

// ApplyAgentInput defines the parameters for the "apply_agent" tool.
type ApplyAgentInput struct {
	Resource string `json:"resource" jsonschema:"required,description=Full agent resource as JSON. Must include api_version (agentic.stigmer.ai/v1)\\, kind (Agent)\\, metadata (org\\, slug\\, name required)\\, and spec (instructions required with min 10 chars). Example: {\"api_version\":\"agentic.stigmer.ai/v1\"\\,\"kind\":\"Agent\"\\,\"metadata\":{\"org\":\"acme\"\\,\"slug\":\"my-agent\"\\,\"name\":\"My Agent\"}\\,\"spec\":{\"instructions\":\"You are a helpful assistant...\"}}"`
}

// ApplyTool returns the MCP tool definition for the apply_agent tool.
func ApplyTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "apply_agent",
		Description: "Create or update a Stigmer agent (idempotent). Provide the full agent resource as JSON.",
	}
}

// ApplyHandler returns the typed tool handler for apply_agent.
func ApplyHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *ApplyAgentInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *ApplyAgentInput) (*mcp.CallToolResult, any, error) {
		return domains.CallApply(Apply, ctx, serverAddress, input.Resource)
	}
}

// --- delete_agent ---

// DeleteAgentInput defines the parameters for the "delete_agent" tool.
type DeleteAgentInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the agent (e.g. stigmer)."`
	Slug string `json:"slug" jsonschema:"required,description=Agent slug — the unique identifier within the org (e.g. code-reviewer)."`
}

// DeleteTool returns the MCP tool definition for the delete_agent tool.
func DeleteTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "delete_agent",
		Description: "Delete a Stigmer agent by its org and slug. Returns the deleted agent.",
	}
}

// DeleteHandler returns the typed tool handler for delete_agent.
func DeleteHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *DeleteAgentInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *DeleteAgentInput) (*mcp.CallToolResult, any, error) {
		return domains.CallFetch(Delete, ctx, serverAddress, input.Org, input.Slug)
	}
}
