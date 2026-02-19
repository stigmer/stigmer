// Package mcpservers provides the "get_mcp_server" MCP tool and resource
// template backed by the McpServerQueryController.getByReference RPC.
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

// Fetch retrieves an MCP server by org and slug, returning its JSON
// representation. It handles authentication, gRPC connection lifecycle,
// timeout, and serialization so that both tool and resource handlers can
// share this logic.
func Fetch(ctx context.Context, serverAddress, org, slug string) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("mcpservers.Fetch: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	client := mcpserverv1.NewMcpServerQueryControllerClient(conn)
	mcpServer, err := client.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	})
	if err != nil {
		return "", domains.RPCError(err, fmt.Sprintf("MCP server %q in org %q", slug, org))
	}

	return domains.MarshalJSON(mcpServer)
}
