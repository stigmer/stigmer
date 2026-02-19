package agents

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

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
		text, err := Delete(ctx, serverAddress, input.Org, input.Slug)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
