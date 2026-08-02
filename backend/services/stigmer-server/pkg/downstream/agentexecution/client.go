package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the AgentExecution service.
//
// Architecture Note: This client lives OUTSIDE the agentexecution domain
// because it's infrastructure for calling the agent-execution service from
// other domains (first consumer: the schedule clock's run starter). When
// services are split into separate microservices, this client will be used
// by external services to make network gRPC calls.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind
//     injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// The interceptor chain is load-bearing, not a convenience: three create
// pipeline steps read api_resource_kind from an interceptor-injected
// context value, so a direct controller method call would persist rows
// under kind `unknown` and every subsequent read would miss them.
type Client struct {
	conn        *grpc.ClientConn
	client      agentexecutionv1.AgentExecutionCommandControllerClient
	queryClient agentexecutionv1.AgentExecutionQueryControllerClient
}

// NewClient creates a new in-process AgentExecution client using a gRPC
// connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:        conn,
		client:      agentexecutionv1.NewAgentExecutionCommandControllerClient(conn),
		queryClient: agentexecutionv1.NewAgentExecutionQueryControllerClient(conn),
	}
}

// Create creates a new agent execution through the full create pipeline —
// session auto-create, execution-context assembly, persist, and the
// Temporal workflow start all included.
func (c *Client) Create(ctx context.Context, execution *agentexecutionv1.AgentExecution) (*agentexecutionv1.AgentExecution, error) {
	log.Debug().
		Str("agent_id", execution.GetSpec().GetAgentId()).
		Str("name", execution.GetMetadata().GetName()).
		Msg("Creating agent execution via in-process gRPC")

	created, err := c.client.Create(ctx, execution)
	if err != nil {
		log.Error().Err(err).
			Str("agent_id", execution.GetSpec().GetAgentId()).
			Str("name", execution.GetMetadata().GetName()).
			Msg("Failed to create agent execution")
		return nil, err
	}

	log.Info().
		Str("id", created.GetMetadata().GetId()).
		Str("session_id", created.GetSpec().GetSessionId()).
		Msg("Successfully created agent execution")
	return created, nil
}

// Get retrieves an agent execution by ID.
func (c *Client) Get(ctx context.Context, id string) (*agentexecutionv1.AgentExecution, error) {
	return c.queryClient.Get(ctx, &agentexecutionv1.AgentExecutionId{Value: id})
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
