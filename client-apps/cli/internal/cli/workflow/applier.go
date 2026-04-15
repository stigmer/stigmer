// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"google.golang.org/grpc"
)

// ApplyOptions contains options for applying a Workflow configuration.
type ApplyOptions struct {
	// Workflow is the Workflow proto to apply.
	Workflow *workflowv1.Workflow
	// OrgID is the organization ID for the resource.
	OrgID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
	// Quiet suppresses detailed output.
	Quiet bool
	// DryRun validates without applying.
	DryRun bool
}

// ApplyResult contains the result of applying a Workflow configuration.
type ApplyResult struct {
	// Workflow is the applied Workflow (from server response).
	Workflow *workflowv1.Workflow
	// Created is true if resource was created, false if updated.
	Created bool
}

// Apply applies a Workflow configuration to the backend.
// It uses the Apply RPC which handles both create and update (idempotent).
func Apply(opts *ApplyOptions) (*ApplyResult, error) {
	if opts.Workflow == nil {
		return nil, fmt.Errorf("workflow is required")
	}

	if opts.Conn == nil {
		return nil, fmt.Errorf("connection is required")
	}

	// Ensure metadata exists and set organization
	if opts.Workflow.Metadata == nil {
		opts.Workflow.Metadata = &apiresource.ApiResourceMetadata{}
	}

	// Set organization if not already set
	if opts.Workflow.Metadata.Org == "" && opts.OrgID != "" {
		opts.Workflow.Metadata.Org = opts.OrgID
	}

	// Dry run - just validate and return
	if opts.DryRun {
		if !opts.Quiet {
			climsg.Info("Dry run mode - configuration is valid")
			displayWorkflowSummary(opts.Workflow)
		}
		return &ApplyResult{
			Workflow: opts.Workflow,
			Created:  false,
		}, nil
	}

	// Check if resource exists to determine create vs update
	existingID := opts.Workflow.Metadata.Id
	isCreate := existingID == ""

	if !opts.Quiet {
		if isCreate {
			climsg.Info("Creating workflow: %s", opts.Workflow.Metadata.Name)
		} else {
			climsg.Info("Updating workflow: %s", opts.Workflow.Metadata.Name)
		}
	}

	// Call Apply RPC
	client := workflowv1.NewWorkflowCommandControllerClient(opts.Conn)
	result, err := client.Apply(context.Background(), opts.Workflow)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply workflow")
	}

	return &ApplyResult{
		Workflow: result,
		Created:  isCreate,
	}, nil
}
