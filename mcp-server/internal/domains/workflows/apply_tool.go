package workflows

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ApplyWorkflowInput defines the parameters for the "apply_workflow" tool.
type ApplyWorkflowInput struct {
	Resource string `json:"resource" jsonschema:"required,description=Full workflow resource as JSON. Must include api_version (agentic.stigmer.ai/v1)\\, kind (Workflow)\\, metadata (org\\, slug\\, name required)\\, and spec (document and tasks required). The spec.document must include dsl\\, namespace\\, name\\, and version. Tasks is a list with at least one entry."`
}

// ApplyTool returns the MCP tool definition for the apply_workflow tool.
func ApplyTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "apply_workflow",
		Description: "Create or update a Stigmer workflow (idempotent). Provide the full workflow resource as JSON.",
	}
}

// ApplyHandler returns the typed tool handler for apply_workflow.
func ApplyHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *ApplyWorkflowInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *ApplyWorkflowInput) (*mcp.CallToolResult, any, error) {
		text, err := Apply(ctx, serverAddress, input.Resource)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
