package agent

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// Delete deletes an agent
func (c *AgentController) Delete(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	if agentId == nil || agentId.Value == "" {
		return nil, grpclib.InvalidArgumentError("agent id is required")
	}

	// Get agent before deletion (to return it)
	agent := &agentv1.Agent{}
	if err := c.store.GetResource(ctx, agentId.Value, agent); err != nil {
		return nil, grpclib.NotFoundError("Agent", agentId.Value)
	}

	// Delete agent
	if err := c.store.DeleteResource(ctx, agentId.Value); err != nil {
		return nil, grpclib.InternalError(err, "failed to delete agent")
	}

	return agent, nil
}
