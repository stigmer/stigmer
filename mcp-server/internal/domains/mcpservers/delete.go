package mcpservers

import (
	"context"
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	"google.golang.org/grpc"
)

// Delete removes an MCP server identified by org and slug. It first resolves
// the org/slug pair to a resource ID via GetByReference, then calls the
// CommandController.Delete RPC with an ApiResourceDeleteInput. Both calls
// share a single gRPC connection.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			desc := fmt.Sprintf("MCP server %q in org %q", slug, org)

			queryClient := mcpserverv1.NewMcpServerQueryControllerClient(conn)
			mcpServer, err := queryClient.GetByReference(ctx, &apiresource.ApiResourceReference{
				Org:  org,
				Kind: apiresourcekind.ApiResourceKind_mcp_server,
				Slug: slug,
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			cmdClient := mcpserverv1.NewMcpServerCommandControllerClient(conn)
			deleted, err := cmdClient.Delete(ctx, &apiresource.ApiResourceDeleteInput{
				ResourceId: mcpServer.GetMetadata().GetId(),
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			return domains.MarshalJSON(deleted)
		})
}
