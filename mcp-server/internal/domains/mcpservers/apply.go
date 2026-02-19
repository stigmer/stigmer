package mcpservers

import (
	"context"
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// Apply creates or updates an MCP server via the
// McpServerCommandController.apply RPC. The resourceJSON parameter must be a
// valid JSON representation of the McpServer protobuf message.
func Apply(ctx context.Context, serverAddress, resourceJSON string) (string, error) {
	var mcpServer mcpserverv1.McpServer
	if err := domains.UnmarshalJSON(resourceJSON, &mcpServer); err != nil {
		return "", fmt.Errorf("invalid MCP server JSON: %w", err)
	}

	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("mcpservers.Apply: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	client := mcpserverv1.NewMcpServerCommandControllerClient(conn)
	result, err := client.Apply(rpcCtx, &mcpServer)
	if err != nil {
		desc := fmt.Sprintf("MCP server %q in org %q", mcpServer.GetMetadata().GetSlug(), mcpServer.GetMetadata().GetOrg())
		return "", domains.RPCError(err, desc)
	}

	return domains.MarshalJSON(result)
}
