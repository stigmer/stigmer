package environment

import (
	"context"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the Environment service.
//
// Architecture Note: This client lives OUTSIDE the environment domain because it's
// infrastructure for calling the environment service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the environment service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// Implementation Notes:
//   - Real gRPC calls: Uses bufconn for in-process gRPC with full interceptor chain
//   - Blocking calls: Synchronous environment operations via blocking stub
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - Propagates context: Uses provided context for authentication/authorization
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the environment service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the environment service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn        *grpc.ClientConn
	queryClient environmentv1.EnvironmentQueryControllerClient
}

// NewClient creates a new in-process Environment client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:        conn,
		queryClient: environmentv1.NewEnvironmentQueryControllerClient(conn),
	}
}

// GetByReference retrieves an environment by its org/kind/slug reference.
//
// This makes an in-process gRPC call to EnvironmentQueryController.GetByReference()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Use case: During agent execution creation, environment_refs from the AgentInstance
// are resolved to full Environment resources so their data can be merged into the
// ExecutionContext.
func (c *Client) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*environmentv1.Environment, error) {
	log.Debug().
		Str("org", ref.GetOrg()).
		Str("slug", ref.GetSlug()).
		Msg("Getting environment by reference via in-process gRPC")

	env, err := c.queryClient.GetByReference(ctx, ref)
	if err != nil {
		log.Error().
			Err(err).
			Str("org", ref.GetOrg()).
			Str("slug", ref.GetSlug()).
			Msg("Failed to get environment by reference")
		return nil, err
	}

	log.Debug().
		Str("id", env.GetMetadata().GetId()).
		Str("name", env.GetMetadata().GetName()).
		Msg("Successfully retrieved environment")

	return env, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
