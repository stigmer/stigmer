package agents

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// Delete removes an agent identified by org and slug. It first resolves the
// org/slug pair to a resource ID via GetByReference, then calls the
// CommandController.Delete RPC. Both calls share a single gRPC connection.
func Delete(ctx context.Context, serverAddress, org, slug string) (string, error) {
	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("agents.Delete: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	resourceDesc := fmt.Sprintf("agent %q in org %q", slug, org)

	queryClient := agentv1.NewAgentQueryControllerClient(conn)
	agent, err := queryClient.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_agent,
		Slug: slug,
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	cmdClient := agentv1.NewAgentCommandControllerClient(conn)
	deleted, err := cmdClient.Delete(rpcCtx, &agentv1.AgentId{
		Value: agent.GetMetadata().GetId(),
	})
	if err != nil {
		return "", domains.RPCError(err, resourceDesc)
	}

	return domains.MarshalJSON(deleted)
}
