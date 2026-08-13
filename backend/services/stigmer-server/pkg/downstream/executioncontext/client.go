package executioncontext

import (
	"context"

	"github.com/rs/zerolog/log"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the ExecutionContext service.
//
// Architecture Note: This client lives OUTSIDE the executioncontext domain because it's
// infrastructure for calling the executioncontext service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the executioncontext service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// Implementation Notes:
//   - Real gRPC calls: Uses bufconn for in-process gRPC with full interceptor chain
//   - Blocking calls: Synchronous execution context operations via blocking stub
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - Propagates context: Uses provided context for authentication/authorization
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the executioncontext service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the executioncontext service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn      *grpc.ClientConn
	cmdClient executioncontextv1.ExecutionContextCommandControllerClient
}

// NewClient creates a new in-process ExecutionContext client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:      conn,
		cmdClient: executioncontextv1.NewExecutionContextCommandControllerClient(conn),
	}
}

// Create creates a new ExecutionContext resource.
//
// This makes an in-process gRPC call to ExecutionContextCommandController.Create()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Use case: During agent execution creation, the execution engine builds an
// ExecutionContext with the fully-merged environment (environment_refs values
// overridden by runtime_env, filtered to the agent's declared env keys) and
// persists it so the agent-runner can retrieve it without secrets flowing
// through the Temporal workflow history.
func (c *Client) Create(ctx context.Context, ec *executioncontextv1.ExecutionContext) (*executioncontextv1.ExecutionContext, error) {
	log.Debug().
		Str("execution_id", ec.GetSpec().GetExecutionId()).
		Msg("Creating execution context via in-process gRPC")

	created, err := c.cmdClient.Create(ctx, ec)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", ec.GetSpec().GetExecutionId()).
			Msg("Failed to create execution context")
		return nil, err
	}

	log.Debug().
		Str("id", created.GetMetadata().GetId()).
		Str("execution_id", created.GetSpec().GetExecutionId()).
		Msg("Successfully created execution context")

	return created, nil
}

// Delete deletes an ExecutionContext by resource ID.
//
// This makes an in-process gRPC call to ExecutionContextCommandController.Delete()
// using ApiResourceDeleteInput (the standard delete input pattern for this controller).
//
// Use case: When an agent execution workflow completes (success or failure), the
// cleanup activity deletes the ephemeral ExecutionContext to ensure secrets are not
// retained beyond the execution lifetime.
func (c *Client) Delete(ctx context.Context, resourceID string) (*executioncontextv1.ExecutionContext, error) {
	log.Debug().
		Str("resource_id", resourceID).
		Msg("Deleting execution context via in-process gRPC")

	input := &apiresource.ApiResourceDeleteInput{
		ResourceId: resourceID,
	}

	deleted, err := c.cmdClient.Delete(ctx, input)
	if err != nil {
		log.Error().
			Err(err).
			Str("resource_id", resourceID).
			Msg("Failed to delete execution context")
		return nil, err
	}

	log.Debug().
		Str("id", deleted.GetMetadata().GetId()).
		Msg("Successfully deleted execution context")

	return deleted, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
