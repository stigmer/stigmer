// Package project provides CLI utilities for managing Project resources.
package project

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"google.golang.org/grpc"
)

// ApplyOptions contains options for applying a Project configuration.
type ApplyOptions struct {
	// Project is the Project proto to apply.
	Project *projectv1.Project
	// OrgID is the organization ID for the resource.
	OrgID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
	// Quiet suppresses detailed output.
	Quiet bool
	// DryRun validates without applying.
	DryRun bool
	// Prune enables orphan pruning (default: true).
	// When true, resources not in the desired state are deleted.
	Prune bool
}

// ApplyResult contains the result of applying a Project configuration.
type ApplyResult struct {
	// Project is the applied Project (from server response).
	Project *projectv1.Project
	// Created is true if resource was created, false if updated.
	Created bool
}

// Apply applies a Project configuration to the backend.
// It uses the Apply RPC which handles both create and update (idempotent).
//
// The Project.Spec.Members should contain references to resources that have
// already been applied individually by the CLI. The backend will:
// 1. Create/update the Project entity
// 2. Compare previous members with current members (set difference)
// 3. Optionally prune orphaned resources (members removed since last apply)
// 4. Return the Project with ReconciliationSummary populated
func Apply(opts *ApplyOptions) (*ApplyResult, error) {
	if err := validateApplyOptions(opts); err != nil {
		return nil, err
	}

	// Ensure metadata exists and set organization
	if opts.Project.Metadata == nil {
		opts.Project.Metadata = &apiresource.ApiResourceMetadata{}
	}

	// Set organization if not already set
	if opts.Project.Metadata.Org == "" && opts.OrgID != "" {
		opts.Project.Metadata.Org = opts.OrgID
	}

	// Dry run - just validate and return
	if opts.DryRun {
		if !opts.Quiet {
			climsg.Info("Dry run mode - configuration is valid")
			displayProjectSummary(opts.Project)
		}
		return &ApplyResult{
			Project: opts.Project,
			Created: false,
		}, nil
	}

	// Check if resource exists to determine create vs update
	existingID := opts.Project.Metadata.Id
	isCreate := existingID == ""

	if !opts.Quiet {
		if isCreate {
			climsg.Info("Creating project: %s", opts.Project.Metadata.Name)
		} else {
			climsg.Info("Updating project: %s", opts.Project.Metadata.Name)
		}
	}

	// Call Apply RPC
	client := projectv1.NewProjectCommandControllerClient(opts.Conn)
	result, err := client.Apply(context.Background(), opts.Project)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply project")
	}

	return &ApplyResult{
		Project: result,
		Created: isCreate,
	}, nil
}

// validateApplyOptions validates the ApplyOptions fields.
func validateApplyOptions(opts *ApplyOptions) error {
	if opts == nil {
		return fmt.Errorf("apply options cannot be nil")
	}

	if opts.Project == nil {
		return fmt.Errorf("project is required")
	}

	if opts.Conn == nil {
		return fmt.Errorf("connection is required")
	}

	return nil
}
