// Package project provides CLI utilities for managing Project resources.
package project

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
)

// ApplyOptions contains options for applying a Project configuration.
type ApplyOptions struct {
	// Project is the Project proto to apply.
	Project *projectv1.Project
	// OrgID is the organization ID for the resource.
	OrgID string
	// Client is the Stigmer SDK client.
	Client *stigmer.Client
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
func Apply(opts *ApplyOptions) (*ApplyResult, error) {
	if err := validateApplyOptions(opts); err != nil {
		return nil, err
	}

	if opts.Project.Metadata == nil {
		opts.Project.Metadata = &apiresource.ApiResourceMetadata{}
	}

	if opts.Project.Metadata.Org == "" && opts.OrgID != "" {
		opts.Project.Metadata.Org = opts.OrgID
	}

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

	isCreate := opts.Project.Metadata.Id == ""

	if !opts.Quiet {
		if isCreate {
			climsg.Info("Creating project: %s", opts.Project.Metadata.Name)
		} else {
			climsg.Info("Updating project: %s", opts.Project.Metadata.Name)
		}
	}

	result, err := opts.Client.Project.Apply(context.Background(), stigmer.ProjectInputFromProto(opts.Project))
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

	if opts.Client == nil {
		return fmt.Errorf("client is required")
	}

	return nil
}
