package agents

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	agentv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
)

// Delete removes an agent identified by org and slug. It first resolves the
// org/slug pair to a resource ID via GetByReference, then calls the
// CommandController.Delete RPC. Both calls share a single gRPC connection.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			desc := fmt.Sprintf("agent %q in org %q", slug, org)

			queryClient := agentv1.NewAgentQueryControllerClient(conn)
			agent, err := queryClient.GetByReference(ctx, &apiresource.ApiResourceReference{
				Org:  org,
				Kind: apiresourcekind.ApiResourceKind_agent,
				Slug: slug,
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			cmdClient := agentv1.NewAgentCommandControllerClient(conn)
			deleted, err := cmdClient.Delete(ctx, &agentv1.AgentId{
				Value: agent.GetMetadata().GetId(),
			})
			if err != nil {
				return "", domains.RPCError(err, desc)
			}

			return domains.MarshalJSON(deleted)
		})
}
