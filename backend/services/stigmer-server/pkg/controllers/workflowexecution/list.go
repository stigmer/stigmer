package workflowexecution

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// List retrieves all workflow executions
//
// This is a simplified implementation for Stigmer OSS.
// In production Cloud, this would:
// - Use IAM Policy to filter by authorized resource IDs
// - Support pagination
// - Support filtering by workflow_instance_id, phase, etc.
//
// For OSS (local single-user environment):
// - Returns all executions from BadgerDB
// - No authorization filtering (single user)
// - No pagination (acceptable for local usage)
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - IAM Policy authorization filtering (no multi-tenant auth)
// - Pagination (not needed for local usage)
// - Advanced filtering (can be added later if needed)
func (c *WorkflowExecutionController) List(ctx context.Context, req *workflowexecutionv1.ListWorkflowExecutionsRequest) (*workflowexecutionv1.WorkflowExecutionList, error) {
	// List all workflow executions from store
	data, err := c.store.ListResources(ctx, "WorkflowExecution")
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list workflow executions")
	}

	executions := make([]*workflowexecutionv1.WorkflowExecution, 0, len(data))
	for _, d := range data {
		execution := &workflowexecutionv1.WorkflowExecution{}
		if err := protojson.Unmarshal(d, execution); err != nil {
			continue // Skip invalid entries
		}
		executions = append(executions, execution)
	}

	return &workflowexecutionv1.WorkflowExecutionList{Entries: executions}, nil
}
