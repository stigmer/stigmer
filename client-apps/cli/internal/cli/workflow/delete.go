// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"context"

	"github.com/pkg/errors"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/grpc"
)

// DeleteOptions contains options for deleting a workflow.
type DeleteOptions struct {
	// WorkflowID is the resource ID of the workflow to delete.
	WorkflowID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	// Workflow is the deleted workflow (returned by server for confirmation).
	Workflow *workflowv1.Workflow
}

// Delete deletes a workflow from the backend.
// Returns the deleted workflow for display/confirmation purposes.
//
// Parameters:
//   - opts: Delete options including workflow ID and connection
//
// Returns the deleted Workflow proto or an error with context.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}
	if opts.WorkflowID == "" {
		return nil, errors.New("workflow ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Conn, opts.WorkflowID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Workflow: deleted}, nil
}

// DeleteFromBackend deletes a workflow by ID via gRPC.
// This is the low-level function that directly calls the backend.
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - workflowID: Resource ID of the workflow to delete (e.g., "wfl_abc123")
//
// Returns the deleted Workflow proto or an error with context.
func DeleteFromBackend(conn grpc.ClientConnInterface, workflowID string) (*workflowv1.Workflow, error) {
	if workflowID == "" {
		return nil, errors.New("workflow ID is required for delete operation")
	}

	client := workflowv1.NewWorkflowCommandControllerClient(conn)
	ctx := context.Background()

	// Workflow API uses WorkflowId type
	deleted, err := client.Delete(ctx, &workflowv1.WorkflowId{
		Value: workflowID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete workflow '%s'", workflowID)
	}

	return deleted, nil
}
