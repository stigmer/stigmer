package execution

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// GetWorkflowExecution fetches a workflow execution from the backend by ID.
func GetWorkflowExecution(client *stigmer.Client, executionID string) (*workflowexecutionv1.WorkflowExecution, error) {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	result, err := client.WorkflowExecution.Get(ctx, executionID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get workflow execution '%s'", executionID)
	}

	return result, nil
}
