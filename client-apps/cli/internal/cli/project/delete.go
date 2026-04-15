// Package project provides CLI utilities for managing Project resources.
package project

import (
	"context"

	"github.com/pkg/errors"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"google.golang.org/grpc"
)

// DeleteOptions contains options for deleting a project.
type DeleteOptions struct {
	// ProjectID is the resource ID of the project to delete.
	ProjectID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	// Project is the deleted project (returned by server for confirmation).
	Project *projectv1.Project
}

// Delete deletes a project from the backend.
// Returns the deleted project for display/confirmation purposes.
//
// Parameters:
//   - opts: Delete options including project ID and connection
//
// Returns the deleted Project proto or an error with context.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}
	if opts.ProjectID == "" {
		return nil, errors.New("project ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Conn, opts.ProjectID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Project: deleted}, nil
}

// DeleteFromBackend deletes a project by ID via gRPC.
// This is the low-level function that directly calls the backend.
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - projectID: Resource ID of the project to delete (e.g., "prj_abc123")
//
// Returns the deleted Project proto or an error with context.
func DeleteFromBackend(conn grpc.ClientConnInterface, projectID string) (*projectv1.Project, error) {
	if projectID == "" {
		return nil, errors.New("project ID is required for delete operation")
	}

	client := projectv1.NewProjectCommandControllerClient(conn)
	ctx := context.Background()

	// Project API uses ProjectId type for delete operations
	deleted, err := client.Delete(ctx, &projectv1.ProjectId{
		Value: projectID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete project '%s'", projectID)
	}

	return deleted, nil
}
