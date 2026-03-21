package mcpservers

import (
	"context"
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	"google.golang.org/grpc"
)

// Apply creates or updates an MCP server via the
// McpServerCommandController.Apply RPC. The proto must be fully constructed
// (use McpServerInput.ToProto()).
func Apply(ctx context.Context, serverAddress string, mcpServer *mcpserverv1.McpServer) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			client := mcpserverv1.NewMcpServerCommandControllerClient(conn)
			result, err := client.Apply(ctx, mcpServer)
			if err != nil {
				desc := fmt.Sprintf("MCP server %q in org %q", mcpServer.GetMetadata().GetSlug(), mcpServer.GetMetadata().GetOrg())
				return "", domains.RPCError(err, desc)
			}
			return domains.MarshalJSON(result)
		})
}
