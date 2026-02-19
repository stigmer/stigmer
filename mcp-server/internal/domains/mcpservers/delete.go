package mcpservers

import (
	"context"
	"fmt"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// Delete removes an MCP server identified by org and slug. It first resolves
// the org/slug pair to a resource ID via GetByReference, then calls the
// CommandController.Delete RPC with an ApiResourceDeleteInput.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("mcpservers.Delete: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	resourceDesc := fmt.Sprintf("MCP server %q in org %q", slug, org)

	queryClient := mcpserverv1.NewMcpServerQueryControllerClient(conn)
	mcpServer, err := queryClient.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	cmdClient := mcpserverv1.NewMcpServerCommandControllerClient(conn)
	deleted, err := cmdClient.Delete(rpcCtx, &apiresource.ApiResourceDeleteInput{
		ResourceId: mcpServer.GetMetadata().GetId(),
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	return domains.MarshalJSON(deleted)
}
