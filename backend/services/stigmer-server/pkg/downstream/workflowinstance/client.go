package workflowinstance

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowinstance/v1"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the WorkflowInstance service.
//
// Architecture Note: This client lives OUTSIDE the workflow instance domain because it's
// infrastructure for calling the workflow instance service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the workflow instance service.
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
// need to call the workflow instance service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the workflow instance service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn   *grpc.ClientConn
	client workflowinstancev1.WorkflowInstanceCommandControllerClient
}

// NewClient creates a new in-process WorkflowInstance client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:   conn,
		client: workflowinstancev1.NewWorkflowInstanceCommandControllerClient(conn),
	}
}

// CreateAsSystem creates a new workflow instance using system credentials.
//
// This makes an in-process gRPC call to WorkflowInstanceCommandController.Create()
// using system context. This ensures all gRPC interceptors run (validation,
// api_resource_kind injection, logging, etc.) before reaching the handler.
//
// System context bypasses user-level authentication and allows backend logic
// to create instances automatically.
//
// Use case: Workflow creation automatically creates a default instance without
// requiring the user to have explicit instance creation permissions.
func (c *Client) CreateAsSystem(ctx context.Context, instance *workflowinstancev1.WorkflowInstance) (*workflowinstancev1.WorkflowInstance, error) {
	log.Debug().
		Str("workflow_id", instance.GetSpec().GetWorkflowId()).
		Str("name", instance.GetMetadata().GetName()).
		Msg("Creating workflow instance via in-process gRPC (as system)")

	// Make gRPC call through in-process connection
	// This ensures all interceptors and middleware execute before the handler
	created, err := c.client.Create(ctx, instance)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", instance.GetSpec().GetWorkflowId()).
			Msg("Failed to create workflow instance (as system)")
		return nil, err
	}

	log.Info().
		Str("id", created.GetMetadata().GetId()).
		Str("workflow_id", created.GetSpec().GetWorkflowId()).
		Msg("Successfully created workflow instance (as system)")

	return created, nil
}

// Close closes the underlying gRPC connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
