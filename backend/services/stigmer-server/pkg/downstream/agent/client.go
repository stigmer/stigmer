package agent

import (
	"context"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the Agent service.
//
// Architecture Note: This client lives OUTSIDE the agent domain because it's
// infrastructure for calling the agent service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the agent service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// Implementation Notes:
//   - Real gRPC calls: Uses bufconn for in-process gRPC with full interceptor chain
//   - Blocking calls: Synchronous agent operations via blocking stub
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - Propagates context: Uses provided context for authentication/authorization
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the agent service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the agent service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn        *grpc.ClientConn
	queryClient agentv1.AgentQueryControllerClient
	cmdClient   agentv1.AgentCommandControllerClient
}

// NewClient creates a new in-process Agent client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:        conn,
		queryClient: agentv1.NewAgentQueryControllerClient(conn),
		cmdClient:   agentv1.NewAgentCommandControllerClient(conn),
	}
}

// Get retrieves an agent by ID.
//
// This makes an in-process gRPC call to AgentQueryController.Get()
// using the provided context. This ensures all gRPC interceptors run (validation,
// api_resource_kind injection, logging, etc.) before reaching the handler.
//
// Context propagation: The provided context is used for the gRPC call, which
// means any authentication/authorization information is propagated through the
// interceptor chain.
//
// Use case: Other domains need to fetch agent details without bypassing the
// interceptor chain, ensuring consistent behavior and proper authorization.
func (c *Client) Get(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	log.Debug().
		Str("agent_id", agentId.GetValue()).
		Msg("Getting agent via in-process gRPC")

	// Make gRPC call through in-process connection
	// This ensures all interceptors and middleware execute before the handler
	agent, err := c.queryClient.Get(ctx, agentId)
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentId.GetValue()).
			Msg("Failed to get agent")
		return nil, err
	}

	log.Debug().
		Str("id", agent.GetMetadata().GetId()).
		Str("name", agent.GetMetadata().GetName()).
		Msg("Successfully retrieved agent")

	return agent, nil
}

// Update updates an existing agent.
//
// This makes an in-process gRPC call to AgentCommandController.Update()
// using the provided context. This ensures all gRPC interceptors run (validation,
// api_resource_kind injection, logging, etc.) before reaching the handler.
//
// Context propagation: The provided context is used for the gRPC call, which
// means any authentication/authorization information is propagated through the
// interceptor chain.
//
// Use case: Other domains need to update agent state (e.g., setting default_instance_id)
// without bypassing the interceptor chain, ensuring proper validation and authorization.
func (c *Client) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	log.Debug().
		Str("agent_id", agent.GetMetadata().GetId()).
		Msg("Updating agent via in-process gRPC")

	// Make gRPC call through in-process connection
	// This ensures all interceptors and middleware execute before the handler
	updated, err := c.cmdClient.Update(ctx, agent)
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agent.GetMetadata().GetId()).
			Msg("Failed to update agent")
		return nil, err
	}

	log.Info().
		Str("id", updated.GetMetadata().GetId()).
		Msg("Successfully updated agent")

	return updated, nil
}

// Close closes the underlying gRPC connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
