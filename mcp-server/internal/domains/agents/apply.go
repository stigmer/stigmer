package agents

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	agentv1 "github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/agentic/agent/v1"
	"google.golang.org/grpc"
)

// Apply creates or updates an agent via the AgentCommandController.Apply RPC.
// The agent proto must be fully constructed (use AgentInput.ToProto()).
func Apply(ctx context.Context, serverAddress string, agent *agentv1.Agent) (string, error) {
	return domains.WithConnection(ctx, serverAddress,
		func(ctx context.Context, conn *grpc.ClientConn) (string, error) {
			client := agentv1.NewAgentCommandControllerClient(conn)
			result, err := client.Apply(ctx, agent)
			if err != nil {
				desc := fmt.Sprintf("agent %q in org %q", agent.GetMetadata().GetSlug(), agent.GetMetadata().GetOrg())
				return "", domains.RPCError(err, desc)
			}
			return domains.MarshalJSON(result)
		})
}
