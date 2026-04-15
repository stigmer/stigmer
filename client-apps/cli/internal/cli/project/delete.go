// Package project provides CLI utilities for managing Project resources.
package project

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
)

// DeleteOptions contains options for deleting a project.
type DeleteOptions struct {
	ProjectID string
	Client    *stigmer.Client
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	Project *projectv1.Project
}

// Delete deletes a project from the backend.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}
	if opts.ProjectID == "" {
		return nil, errors.New("project ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Client, opts.ProjectID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Project: deleted}, nil
}

// DeleteFromBackend deletes a project by ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, projectID string) (*projectv1.Project, error) {
	if projectID == "" {
		return nil, errors.New("project ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.Project.Delete(ctx, projectID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete project '%s'", projectID)
	}

	return deleted, nil
}
