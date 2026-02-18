// Package agents provides the "get_agent" MCP tool backed by the
// AgentQueryController.getByReference RPC.
package agents

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
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
	return func(ctx context.Context, req *mcp.CallToolRequest, input *GetAgentInput) (*mcp.CallToolResult, any, error) {
		apiKey, err := auth.GetAPIKey(ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("get_agent: %w", err)
		}

		conn, err := stigmergrpc.NewConnection(serverAddress, apiKey)
		if err != nil {
			return nil, nil, fmt.Errorf("get_agent: %w", err)
		}
		defer conn.Close()

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		client := agentv1.NewAgentQueryControllerClient(conn)
		agent, err := client.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
			Org:  input.Org,
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: input.Slug,
		})
		if err != nil {
			return nil, nil, domains.RPCError(err, fmt.Sprintf("agent %q in org %q", input.Slug, input.Org))
		}

		text, err := domains.MarshalJSON(agent)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
