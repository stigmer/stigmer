package execution

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// ListWorkflowOptions contains options for listing workflow executions.
type ListWorkflowOptions struct {
	Client *stigmer.Client

	// PageSize is the maximum number of results to return.
	PageSize int32

	// PageToken is the token for pagination.
	PageToken string
}

// ListWorkflow retrieves workflow executions from the backend.
func ListWorkflow(opts *ListWorkflowOptions) (*workflowexecutionv1.WorkflowExecutionList, error) {
	if opts == nil {
		return nil, errors.New("list options cannot be nil")
	}
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	req := &workflowexecutionv1.ListWorkflowExecutionsRequest{
		PageSize:  pageSize,
		PageToken: opts.PageToken,
	}

	result, err := opts.Client.WorkflowExecution.List(ctx, req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list workflow executions")
	}

	return result, nil
}
