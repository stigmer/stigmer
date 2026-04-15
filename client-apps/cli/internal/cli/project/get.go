// Package project provides CLI utilities for managing Project resources.
package project

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches a project from the backend by reference.
// The reference can be a slug (e.g., "my-project"), org/slug (e.g., "stigmer/my-project"),
// or a resource ID (e.g., "prj_abc123").
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - orgID: Organization ID for context (used when reference is slug-only)
//   - ref: Resource reference string
//
// Returns the Project proto or an error with context.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*projectv1.Project, error) {
	// Parse the reference (handles slug, org/slug, and resource ID)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid project reference")
	}

	client := projectv1.NewProjectQueryControllerClient(conn)
	ctx := context.Background()

	var result *projectv1.Project

	if parsed.IsID {
		// Get by resource ID
		result, err = client.Get(ctx, &projectv1.ProjectId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get project by ID '%s'", parsed.ID)
		}
	} else {
		// Get by org/slug reference
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_project,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get project '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching a project.
type GetOptions struct {
	// Reference is the project reference (slug, org/slug, or resource ID).
	Reference string
	// OrgID is the organization ID for context (used when reference is slug-only).
	OrgID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// Get fetches a project from the backend using the provided options.
// This is a convenience wrapper around GetFromBackend for structured options.
func Get(opts *GetOptions) (*projectv1.Project, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("project reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
