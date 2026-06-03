package workflows

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
	workflowv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/workflow/v1"
)

// --- get_task_kind_registry ---

// GetTaskKindRegistryTool returns the MCP tool definition for registration.
func GetTaskKindRegistryTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_task_kind_registry",
		Description: "Get the complete workflow task kind registry with all 20 task kind descriptors, field schemas, JSON Schemas, categories, examples, and output shapes.",
	}
}

// GetTaskKindRegistryInput has no parameters — the registry is a static catalog.
type GetTaskKindRegistryInput struct{}

// GetTaskKindRegistryHandler returns the typed tool handler.
func GetTaskKindRegistryHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetTaskKindRegistryInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, _ *GetTaskKindRegistryInput) (*mcp.CallToolResult, any, error) {
		conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
		if err != nil {
			return nil, nil, fmt.Errorf("get_task_kind_registry: %w", err)
		}
		defer conn.Close()

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		client := workflowv1.NewTaskKindRegistryQueryControllerClient(conn)
		resp, err := client.GetTaskKindRegistry(rpcCtx, &workflowv1.GetTaskKindRegistryRequest{})
		if err != nil {
			return nil, nil, domains.RPCError(err, "task kind registry")
		}

		text, err := domains.MarshalJSON(resp)
		if err != nil {
			return nil, nil, err
		}
		return domains.TextResult(text)
	}
}

// --- get_task_kind ---

// GetTaskKindInput defines the parameters for the "get_task_kind" tool.
type GetTaskKindInput struct {
	Kind string `json:"kind" jsonschema:"Task kind name (one of: set_vars, http_call, grpc_call, activity_call, switch_case, for_each, fork, try_catch, listen, wait, raise_error, run_workflow, agent_call, llm_call, transform, human_input, validate, emit_event, notification, eval)."`
}

// GetTaskKindTool returns the MCP tool definition for registration.
func GetTaskKindTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "get_task_kind",
		Description: "Get a single workflow task kind descriptor by name with field schemas, JSON Schema, examples, and output shape.",
	}
}

// GetTaskKindHandler returns the typed tool handler.
func GetTaskKindHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetTaskKindInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetTaskKindInput) (*mcp.CallToolResult, any, error) {
		if input.Kind == "" {
			return nil, nil, fmt.Errorf("kind is required")
		}

		conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
		if err != nil {
			return nil, nil, fmt.Errorf("get_task_kind: %w", err)
		}
		defer conn.Close()

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		client := workflowv1.NewTaskKindRegistryQueryControllerClient(conn)
		resp, err := client.GetTaskKindRegistry(rpcCtx, &workflowv1.GetTaskKindRegistryRequest{})
		if err != nil {
			return nil, nil, domains.RPCError(err, "task kind registry")
		}

		normalizedKind := strings.ToLower(strings.TrimSpace(input.Kind))
		for _, desc := range resp.GetDescriptors() {
			if strings.ToLower(desc.GetKind().String()) == normalizedKind {
				text, err := domains.MarshalJSON(desc)
				if err != nil {
					return nil, nil, err
				}
				return domains.TextResult(text)
			}
		}

		return nil, nil, fmt.Errorf("task kind %q not found in registry; use get_task_kind_registry to see all available kinds", input.Kind)
	}
}
