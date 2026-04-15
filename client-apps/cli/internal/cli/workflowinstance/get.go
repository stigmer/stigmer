package workflowinstance

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches a workflow instance from the backend by reference.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*workflowinstancev1.WorkflowInstance, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid workflow instance reference")
	}

	client := workflowinstancev1.NewWorkflowInstanceQueryControllerClient(conn)
	ctx := context.Background()

	var result *workflowinstancev1.WorkflowInstance

	if parsed.IsID {
		result, err = client.Get(ctx, &workflowinstancev1.WorkflowInstanceId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get workflow instance by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_workflow_instance,
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
	Conn      grpc.ClientConnInterface
}

// Get fetches a workflow instance from the backend using the provided options.
func Get(opts *GetOptions) (*workflowinstancev1.WorkflowInstance, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("workflow instance reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
