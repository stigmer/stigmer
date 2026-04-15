package workflowinstance

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowinstance/v1"
)

// DeleteFromBackend deletes a workflow instance by resource ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, resourceID string) (*workflowinstancev1.WorkflowInstance, error) {
	if resourceID == "" {
		return nil, errors.New("workflow instance ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.WorkflowInstance.Delete(ctx, resourceID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete workflow instance '%s'", resourceID)
	}

	return deleted, nil
}
