package session

import (
	"context"

	"github.com/rs/zerolog/log"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the Session service.
//
// Architecture Note: This client lives OUTSIDE the session domain because it's
// infrastructure for calling the session service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the session service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// Implementation Notes:
//   - Real gRPC calls: Uses bufconn for in-process gRPC with full interceptor chain
//   - Blocking calls: Synchronous session operations via blocking stub
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - Propagates context: Uses provided context for authentication/authorization
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the session service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the session service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn        *grpc.ClientConn
	client      sessionv1.SessionCommandControllerClient
	queryClient sessionv1.SessionQueryControllerClient
}

// NewClient creates a new in-process Session client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:        conn,
		client:      sessionv1.NewSessionCommandControllerClient(conn),
		queryClient: sessionv1.NewSessionQueryControllerClient(conn),
	}
}

// Get retrieves a session by ID.
//
// This makes an in-process gRPC call to SessionQueryController.Get()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Use case: During agent execution creation, resolve the session to obtain
// the agent_instance_id for environment merging.
func (c *Client) Get(ctx context.Context, id string) (*sessionv1.Session, error) {
	log.Debug().
		Str("session_id", id).
		Msg("Getting session via in-process gRPC")

	session, err := c.queryClient.Get(ctx, &sessionv1.SessionId{Value: id})
	if err != nil {
		log.Error().
			Err(err).
			Str("session_id", id).
			Msg("Failed to get session")
		return nil, err
	}

	log.Debug().
		Str("id", session.GetMetadata().GetId()).
		Str("agent_instance_id", session.GetSpec().GetAgentInstanceId()).
		Msg("Successfully retrieved session")

	return session, nil
}

// Create creates a new session.
//
// This makes an in-process gRPC call to SessionCommandController.Create()
// using the provided context. This ensures all gRPC interceptors run (validation,
// api_resource_kind injection, logging, etc.) before reaching the handler.
//
// Context propagation: The provided context is used for the gRPC call, which
// means any authentication/authorization information is propagated through the
// interceptor chain.
//
// Use case: Agent execution automatically creates a session if session_id is not
// provided, allowing the caller's permissions to be properly checked.
func (c *Client) Create(ctx context.Context, session *sessionv1.Session) (*sessionv1.Session, error) {
	log.Debug().
		Str("agent_instance_id", session.GetSpec().GetAgentInstanceId()).
		Str("subject", session.GetSpec().GetSubject()).
		Msg("Creating session via in-process gRPC")

	// Make gRPC call through in-process connection
	// This ensures all interceptors and middleware execute before the handler
	created, err := c.client.Create(ctx, session)
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_instance_id", session.GetSpec().GetAgentInstanceId()).
			Msg("Failed to create session")
		return nil, err
	}

	log.Info().
		Str("id", created.GetMetadata().GetId()).
		Str("agent_instance_id", created.GetSpec().GetAgentInstanceId()).
		Msg("Successfully created session")

	return created, nil
}

// Close closes the underlying gRPC connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
