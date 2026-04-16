package workflowinstance

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowinstance/v1"
)

// GetFromBackend fetches a workflow instance from the backend by reference.
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*workflowinstancev1.WorkflowInstance, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid workflow instance reference")
	}

	ctx := context.Background()

	var result *workflowinstancev1.WorkflowInstance

	if parsed.IsID {
		result, err = client.WorkflowInstance.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get workflow instance by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.WorkflowInstance.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get workflow instance '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching a workflow instance.
type GetOptions struct {
	Reference string
	OrgID     string
	Client    *stigmer.Client
}

// Get fetches a workflow instance from the backend using the provided options.
func Get(opts *GetOptions) (*workflowinstancev1.WorkflowInstance, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("workflow instance reference cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
}
