package agentinstance

import (
	"context"

	"github.com/pkg/errors"
	agentinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentinstance/v1"
	"google.golang.org/grpc"
)

// DeleteFromBackend deletes an agent instance by resource ID via gRPC.
func DeleteFromBackend(conn grpc.ClientConnInterface, resourceID string) (*agentinstancev1.AgentInstance, error) {
	if resourceID == "" {
		return nil, errors.New("agent instance ID is required for delete operation")
	}

	client := agentinstancev1.NewAgentInstanceCommandControllerClient(conn)
	ctx := context.Background()

	deleted, err := client.Delete(ctx, &agentinstancev1.AgentInstanceId{
		Value: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete agent instance '%s'", resourceID)
	}

	return deleted, nil
}
