package workflow

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the Workflow service.
//
// Architecture Note: This client lives OUTSIDE the workflow domain because it's
// infrastructure for calling the workflow service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the workflow service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// Implementation Notes:
//   - Real gRPC calls: Uses bufconn for in-process gRPC with full interceptor chain
//   - Blocking calls: Synchronous workflow operations via blocking stub
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - System context: Uses context for backend automation
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the workflow service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the workflow service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn         *grpc.ClientConn
	queryClient  workflowv1.WorkflowQueryControllerClient
	commandClient workflowv1.WorkflowCommandControllerClient
}

// NewClient creates a new in-process Workflow client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:          conn,
		queryClient:   workflowv1.NewWorkflowQueryControllerClient(conn),
		commandClient: workflowv1.NewWorkflowCommandControllerClient(conn),
	}
}

// Get retrieves a workflow by ID.
//
// This makes an in-process gRPC call to WorkflowQueryController.Get()
// using the provided context. This ensures all gRPC interceptors run
// (validation, api_resource_kind injection, logging, etc.) before reaching the handler.
//
// Use case: WorkflowExecution creation loads workflow to check for default_instance_id.
func (c *Client) Get(ctx context.Context, id *workflowv1.WorkflowId) (*workflowv1.Workflow, error) {
	log.Debug().
		Str("workflow_id", id.GetValue()).
		Msg("Getting workflow via in-process gRPC")

	// Make gRPC call through in-process connection
	// This ensures all interceptors and middleware execute before the handler
	workflow, err := c.queryClient.Get(ctx, id)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", id.GetValue()).
			Msg("Failed to get workflow")
		return nil, err
	}

	log.Debug().
		Str("id", workflow.GetMetadata().GetId()).
		Str("name", workflow.GetMetadata().GetName()).
		Msg("Successfully retrieved workflow")

	return workflow, nil
}

// Update updates a workflow using system credentials.
//
// This makes an in-process gRPC call to WorkflowCommandController.Update()
// using system context. This ensures all gRPC interceptors run (validation,
// api_resource_kind injection, logging, etc.) before reaching the handler.
//
// System context bypasses user-level authentication and allows backend logic
// to update workflows automatically (e.g., setting default_instance_id).
//
// Use case: WorkflowExecution creation automatically updates workflow status
// with default_instance_id without requiring the user to have explicit
// workflow update permissions.
func (c *Client) UpdateAsSystem(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	log.Debug().
		Str("workflow_id", workflow.GetMetadata().GetId()).
		Str("name", workflow.GetMetadata().GetName()).
		Msg("Updating workflow via in-process gRPC (as system)")

	// Make gRPC call through in-process connection
	// This ensures all interceptors and middleware execute before the handler
	updated, err := c.commandClient.Update(ctx, workflow)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflow.GetMetadata().GetId()).
			Msg("Failed to update workflow (as system)")
		return nil, err
	}

	log.Info().
		Str("id", updated.GetMetadata().GetId()).
		Str("name", updated.GetMetadata().GetName()).
		Msg("Successfully updated workflow (as system)")

	return updated, nil
}

// Close closes the underlying gRPC connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
