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

// Fetch retrieves an agent by org and slug, returning its JSON representation.
// It handles authentication, gRPC connection lifecycle, timeout, and
// serialization so that both tool and resource handlers can share this logic.
func Fetch(ctx context.Context, serverAddress, org, slug string) (string, error) {
	apiKey, err := auth.GetAPIKey(ctx)
	if err != nil {
		return "", fmt.Errorf("agents.Fetch: %w", err)
	}

	conn, err := stigmergrpc.NewConnection(serverAddress, apiKey)
	if err != nil {
		return "", fmt.Errorf("agents.Fetch: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	client := agentv1.NewAgentQueryControllerClient(conn)
	agent, err := client.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_agent,
		Slug: slug,
	})
	if err != nil {
		return "", domains.RPCError(err, fmt.Sprintf("agent %q in org %q", slug, org))
	}

	return domains.MarshalJSON(agent)
}
