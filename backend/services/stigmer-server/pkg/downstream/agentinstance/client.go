package agentinstance

import (
	"context"

	"github.com/rs/zerolog/log"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the AgentInstance service.
//
// Architecture Note: This client lives OUTSIDE the agent instance domain because it's
// infrastructure for calling the agent instance service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the agent instance service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// Implementation Notes:
//   - Real gRPC calls: Uses bufconn for in-process gRPC with full interceptor chain
//   - Blocking calls: Synchronous instance operations via blocking stub
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - System context: Uses context for backend automation
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the agent instance service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the agent instance service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn        *grpc.ClientConn
	client      agentinstancev1.AgentInstanceCommandControllerClient
	queryClient agentinstancev1.AgentInstanceQueryControllerClient
}

// NewClient creates a new in-process AgentInstance client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:        conn,
		client:      agentinstancev1.NewAgentInstanceCommandControllerClient(conn),
		queryClient: agentinstancev1.NewAgentInstanceQueryControllerClient(conn),
	}
}

// CreateAsSystem creates a new agent instance using system credentials.
//
// This makes an in-process gRPC call to AgentInstanceCommandController.Create()
// using system context. This ensures all gRPC interceptors run (validation,
// api_resource_kind injection, logging, etc.) before reaching the handler.
//
// System context bypasses user-level authentication and allows backend logic
// to create instances automatically.
//
// Use case: Agent creation automatically creates a default instance without
// requiring the user to have explicit instance creation permissions.
func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
	log.Debug().
		Str("agent_id", instance.GetSpec().GetAgentId()).
		Str("name", instance.GetMetadata().GetName()).
		Msg("Creating agent instance via in-process gRPC (as system)")

	// Make gRPC call through in-process connection
	// This ensures all interceptors and middleware execute before the handler
	created, err := c.client.Create(ctx, instance)
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

// GetByAgent retrieves all agent instances for a specific agent.
//
// This makes an in-process gRPC call to AgentInstanceQueryController.GetByAgent()
// using the provided context. This ensures all gRPC interceptors run before
// reaching the handler.
//
// Use case: When creating an agent execution, check if default instance already
// exists for the agent before attempting to create a new one.
func (c *Client) GetByAgent(ctx context.Context, agentID string) (*agentinstancev1.AgentInstanceList, error) {
	log.Debug().
		Str("agent_id", agentID).
		Msg("Getting agent instances by agent ID via in-process gRPC")

	req := &agentinstancev1.GetAgentInstancesByAgentRequest{
		AgentId: agentID,
	}

	list, err := c.queryClient.GetByAgent(ctx, req)
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentID).
			Msg("Failed to get agent instances by agent ID")
		return nil, err
	}

	log.Debug().
		Str("agent_id", agentID).
		Int32("count", list.GetTotalCount()).
		Msg("Successfully retrieved agent instances")

	return list, nil
}

// Close closes the underlying gRPC connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
