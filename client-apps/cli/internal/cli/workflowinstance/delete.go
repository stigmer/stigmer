package workflowinstance

import (
	"context"

	"github.com/pkg/errors"
	workflowinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowinstance/v1"
	"google.golang.org/grpc"
)

// DeleteFromBackend deletes a workflow instance by resource ID via gRPC.
func DeleteFromBackend(conn grpc.ClientConnInterface, resourceID string) (*workflowinstancev1.WorkflowInstance, error) {
	if resourceID == "" {
		return nil, errors.New("workflow instance ID is required for delete operation")
	}

	client := workflowinstancev1.NewWorkflowInstanceCommandControllerClient(conn)
	ctx := context.Background()

	deleted, err := client.Delete(ctx, &workflowinstancev1.WorkflowInstanceId{
		Value: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete workflow instance '%s'", resourceID)
	}

	return deleted, nil
}
