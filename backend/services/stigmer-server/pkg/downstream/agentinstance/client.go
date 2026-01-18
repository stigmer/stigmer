package agentinstance

import (
	"context"

	"github.com/rs/zerolog/log"
	agentinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentinstance/v1"
)

// Client provides in-process gRPC calls to the AgentInstance service.
//
// Architecture Note: This client lives OUTSIDE the agent instance domain because it's
// infrastructure for calling the agent instance service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the agent instance service.
//
// This implementation calls agent instance handlers directly (in-process),
// providing zero-overhead cross-domain communication while maintaining
// clear domain boundaries.
//
// Implementation Notes:
//   - Zero-overhead communication: Direct function calls in the same process
//   - Blocking calls: Synchronous instance operations
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - System context: Uses context for backend automation
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the agent instance service. Simply replace the controller reference
// with a gRPC client stub pointing to the agent instance service endpoint.
// No changes to the interface are needed - just the implementation.
type Client struct {
	controller agentinstancev1.AgentInstanceCommandControllerServer
}

// NewClient creates a new in-process AgentInstance client
func NewClient(controller agentinstancev1.AgentInstanceCommandControllerServer) *Client {
	return &Client{controller: controller}
}

// CreateAsSystem creates a new agent instance using system credentials.
//
// This makes an in-process call to AgentInstanceCommandController.Create()
// using system context. This bypasses user-level authentication
// and allows backend logic to create instances automatically.
//
// Use case: Agent creation automatically creates a default instance without
// requiring the user to have explicit instance creation permissions.
func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
	log.Debug().
		Str("agent_id", instance.GetSpec().GetAgentId()).
		Str("name", instance.GetMetadata().GetName()).
		Msg("Creating agent instance via in-process call (as system)")

	// Direct call to controller (in-process)
	// System context bypasses user authentication for internal operations
	created, err := c.controller.Create(ctx, instance)
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", instance.GetSpec().GetAgentId()).
			Msg("Failed to create agent instance (as system)")
		return nil, err
	}

	log.Info().
		Str("id", created.GetMetadata().GetId()).
		Str("agent_id", created.GetSpec().GetAgentId()).
		Msg("Successfully created agent instance (as system)")

	return created, nil
}
