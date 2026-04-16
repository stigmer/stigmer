package agentinstance

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentinstance/v1"
)

// DeleteFromBackend deletes an agent instance by resource ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, resourceID string) (*agentinstancev1.AgentInstance, error) {
	if resourceID == "" {
		return nil, errors.New("agent instance ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.AgentInstance.Delete(ctx, resourceID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete agent instance '%s'", resourceID)
	}

	return deleted, nil
}
