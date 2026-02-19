package agents

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

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
		text, err := Apply(ctx, serverAddress, input.Resource)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
