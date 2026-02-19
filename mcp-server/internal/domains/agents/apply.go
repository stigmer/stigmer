package agents

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// Apply creates or updates an agent via the AgentCommandController.apply RPC.
// The resourceJSON parameter must be a valid JSON representation of the Agent
// protobuf message. Unknown fields are silently discarded.
func Apply(ctx context.Context, serverAddress, resourceJSON string) (string, error) {
	var agent agentv1.Agent
	if err := domains.UnmarshalJSON(resourceJSON, &agent); err != nil {
		return "", fmt.Errorf("invalid agent JSON: %w", err)
	}

	conn, err := stigmergrpc.NewConnection(serverAddress, auth.APIKey(ctx))
	if err != nil {
		return "", fmt.Errorf("agents.Apply: %w", err)
	}
	defer conn.Close()

	rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
	defer cancel()

	client := agentv1.NewAgentCommandControllerClient(conn)
	result, err := client.Apply(rpcCtx, &agent)
	if err != nil {
		desc := fmt.Sprintf("agent %q in org %q", agent.GetMetadata().GetSlug(), agent.GetMetadata().GetOrg())
		return "", domains.RPCError(err, desc)
	}

	return domains.MarshalJSON(result)
}
