// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
)

// DeleteOptions contains options for deleting a workflow.
type DeleteOptions struct {
	WorkflowID string
	Client     *stigmer.Client
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	Workflow *workflowv1.Workflow
}

// Delete deletes a workflow from the backend.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}
	if opts.WorkflowID == "" {
		return nil, errors.New("workflow ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Client, opts.WorkflowID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Workflow: deleted}, nil
}

// DeleteFromBackend deletes a workflow by ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, workflowID string) (*workflowv1.Workflow, error) {
	if workflowID == "" {
		return nil, errors.New("workflow ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.Workflow.Delete(ctx, workflowID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete workflow '%s'", workflowID)
	}

	return deleted, nil
}
