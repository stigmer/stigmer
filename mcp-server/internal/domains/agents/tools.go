// Package agents provides the "get_agent" MCP tool backed by the
// AgentQueryController.getByReference RPC.
package agents

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

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
		text, err := Fetch(ctx, serverAddress, input.Org, input.Slug)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
