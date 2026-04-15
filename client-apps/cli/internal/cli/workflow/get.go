// Package workflow provides CLI utilities for managing Workflow resources.
package workflow

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches a workflow from the backend by reference.
// The reference can be a slug (e.g., "my-workflow"), org/slug (e.g., "stigmer/my-workflow"),
// or a resource ID (e.g., "wfl_abc123").
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - orgID: Organization ID for context (used when reference is slug-only)
//   - ref: Resource reference string
//
// Returns the Workflow proto or an error with context.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*workflowv1.Workflow, error) {
	// Parse the reference (handles slug, org/slug, and resource ID)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid workflow reference")
	}

	client := workflowv1.NewWorkflowQueryControllerClient(conn)
	ctx := context.Background()

	var result *workflowv1.Workflow

	if parsed.IsID {
		// Get by resource ID
		result, err = client.Get(ctx, &workflowv1.WorkflowId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get workflow by ID '%s'", parsed.ID)
		}
	} else {
		// Get by org/slug reference
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_workflow,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get workflow '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching a workflow.
type GetOptions struct {
	// Reference is the workflow reference (slug, org/slug, or resource ID).
	Reference string
	// OrgID is the organization ID for context (used when reference is slug-only).
	OrgID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// Get fetches a workflow from the backend using the provided options.
// This is a convenience wrapper around GetFromBackend for structured options.
func Get(opts *GetOptions) (*workflowv1.Workflow, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("workflow reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
