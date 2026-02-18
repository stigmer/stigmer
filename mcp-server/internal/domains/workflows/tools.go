// Package workflows provides the "get_workflow" MCP tool backed by the
// WorkflowQueryController.getByReference RPC.
package workflows

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// GetWorkflowInput defines the parameters for the "get_workflow" tool.
type GetWorkflowInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the workflow."`
	Slug string `json:"slug" jsonschema:"required,description=Workflow slug — unique identifier within the org."`
}

// Tool returns the MCP tool definition for registration.
func Tool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_workflow",
		Description: "Get full details of a Stigmer workflow by its org and slug.",
	}
}

// Handler returns the typed tool handler.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetWorkflowInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input *GetWorkflowInput) (*mcp.CallToolResult, any, error) {
		apiKey, err := auth.GetAPIKey(ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("get_workflow: %w", err)
		}

		conn, err := stigmergrpc.NewConnection(serverAddress, apiKey)
		if err != nil {
			return nil, nil, fmt.Errorf("get_workflow: %w", err)
		}
		defer conn.Close()

		client := workflowv1.NewWorkflowQueryControllerClient(conn)
		workflow, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  input.Org,
			Kind: apiresourcekind.ApiResourceKind_workflow,
			Slug: input.Slug,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("get_workflow RPC: %w", err)
		}

		text, err := domains.MarshalJSON(workflow)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
