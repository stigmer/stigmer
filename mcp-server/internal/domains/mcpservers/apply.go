package mcpservers

import (
	"context"
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	"google.golang.org/grpc"
)

// Apply creates or updates an MCP server via the
// McpServerCommandController.Apply RPC. The resourceJSON parameter must be a
// valid JSON representation of the McpServer protobuf message. Unknown fields
// are silently discarded.
func Apply(ctx context.Context, serverAddress, resourceJSON string) (string, error) {
	var mcpServer mcpserverv1.McpServer
	if err := domains.UnmarshalJSON(resourceJSON, &mcpServer); err != nil {
		return "", fmt.Errorf("invalid MCP server JSON: %w", err)
	}

	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			client := mcpserverv1.NewMcpServerCommandControllerClient(conn)
			result, err := client.Apply(ctx, &mcpServer)
			if err != nil {
				desc := fmt.Sprintf("MCP server %q in org %q", mcpServer.GetMetadata().GetSlug(), mcpServer.GetMetadata().GetOrg())
				return "", domains.RPCError(err, desc)
			}
			return domains.MarshalJSON(result)
		})
}
