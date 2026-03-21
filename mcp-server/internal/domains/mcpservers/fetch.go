// Package mcpservers provides the MCP tools and resource template for the
// McpServer domain, backed by the McpServerQueryController and
// McpServerCommandController RPCs.
package mcpservers

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	mcpserverv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
)

// Fetch retrieves an MCP server by org and slug, returning its JSON
// representation. Both tool and resource handlers delegate to this function
// for the actual RPC.
func Fetch(ctx context.Context, serverAddress, org, slug string) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			client := mcpserverv1.NewMcpServerQueryControllerClient(conn)
			mcpServer, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
				Org:  org,
				Kind: apiresourcekind.ApiResourceKind_mcp_server,
				Slug: slug,
			})
			if err != nil {
				return "", domains.RPCError(err, fmt.Sprintf("MCP server %q in org %q", slug, org))
			}
			return domains.MarshalJSON(mcpServer)
		})
}
