package workflowexecution

import (
	"context"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
)

// List retrieves workflow executions with optional filtering and sorting.
//
// This is a simplified implementation for Stigmer OSS.
// In production Cloud, this would:
// - Use IAM Policy to filter by authorized resource IDs
// - Support cursor-based pagination
//
// For OSS (local single-user environment):
// - Returns all executions from SQLite
// - Supports structured filter criteria (T13)
// - Supports sort field and direction (T13)
// - No authorization filtering (single user)
// - No pagination (acceptable for local usage)
// - The request's `org` field is deliberately a no-op: the local edition is
//   single-tenant, so org scoping (added for the cloud dashboard's
//   org-context views) has nothing to narrow
func (c *WorkflowExecutionController) List(ctx context.Context, req *workflowexecutionv1.ListWorkflowExecutionsRequest) (*workflowexecutionv1.WorkflowExecutionList, error) {
	data, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_execution)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list workflow executions")
	}

	executions := make([]*workflowexecutionv1.WorkflowExecution, 0, len(data))
	for _, d := range data {
		execution := &workflowexecutionv1.WorkflowExecution{}
		if err := proto.Unmarshal(d, execution); err != nil {
			continue
		}
		executions = append(executions, execution)
	}

	// Apply legacy phase filter (backward compat — superseded by filter.phases).
	if req.GetFilter() == nil || len(req.GetFilter().GetPhases()) == 0 {
		executions = applyLegacyPhaseFilter(executions, req.GetPhase())
	}

	// Apply structured filter criteria (T13).
	executions = applyFilterCriteria(executions, req.GetFilter())

	// Apply sort (default: started_at descending).
	sortField := req.GetSortField()
	ascending := req.GetSortAscending()
	if sortField == workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_UNSPECIFIED {
		sortField = workflowexecutionv1.ExecutionSortField_EXECUTION_SORT_FIELD_STARTED_AT
		ascending = false
	}
	applySortField(executions, sortField, ascending)

	return &workflowexecutionv1.WorkflowExecutionList{
		Entries:    executions,
		TotalPages: 1,
	}, nil
}
