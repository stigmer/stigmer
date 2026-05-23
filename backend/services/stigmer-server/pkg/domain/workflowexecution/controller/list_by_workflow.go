package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
)

// ListByWorkflow retrieves all workflow executions for a specific workflow or workflow instance.
//
// This operation lists execution history for a particular workflow, useful for:
//   - Viewing execution history for a workflow in the UI
//   - Analyzing workflow performance over time
//   - Debugging systematic failures
//   - Comparing outputs across executions
//
// Input:
//   - workflow_id: Workflow or WorkflowInstance ID to filter by
//   - page_size: Maximum results per page (optional, default 50, max 100)
//   - page_token: Pagination token (optional)
//
// This is a simplified implementation for Stigmer OSS.
// In production Cloud, this would:
//   - Use IAM Policy to filter by authorized resource IDs
//   - Support full pagination
//   - Sort by created_at descending (newest first)
//
// For OSS (local single-user environment):
//   - Filters all executions by spec.workflow_instance_id
//   - No authorization filtering (single user)
//   - No pagination (acceptable for local usage)
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - IAM Policy authorization filtering (no multi-tenant auth)
//   - Pagination (not needed for local usage)
func (c *WorkflowExecutionController) ListByWorkflow(ctx context.Context, req *workflowexecutionv1.ListWorkflowExecutionsByWorkflowRequest) (*workflowexecutionv1.WorkflowExecutionList, error) {
	workflowId := req.GetWorkflowId()
	if workflowId == "" {
		return nil, grpclib.InvalidArgumentError("workflow_id is required")
	}

	log.Debug().
		Str("workflow_id", workflowId).
		Int32("page_size", req.GetPageSize()).
		Msg("Listing workflow executions by workflow_id")

	// List all workflow executions from store
	data, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_execution)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowId).
			Msg("Failed to list workflow executions from store")
		return nil, grpclib.InternalError(err, "failed to list workflow executions")
	}

	// Filter executions matching the provided workflow or instance ID.
	// The request field accepts either a Workflow ID (wf_*) or WorkflowInstance ID (wfi_*),
	// so we check both spec.workflowInstanceId and spec.workflowId.
	executions := make([]*workflowexecutionv1.WorkflowExecution, 0)
	for _, d := range data {
		execution := &workflowexecutionv1.WorkflowExecution{}
		if err := proto.Unmarshal(d, execution); err != nil {
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal workflow execution, skipping")
			continue
		}

		if execution.GetSpec().GetWorkflowInstanceId() == workflowId ||
			execution.GetSpec().GetWorkflowId() == workflowId {
			executions = append(executions, execution)
		}
	}

	log.Debug().
		Str("workflow_id", workflowId).
		Int("total_found", len(data)).
		Int("matching", len(executions)).
		Msg("Filtered workflow executions by workflow_id")

	return &workflowexecutionv1.WorkflowExecutionList{
		Entries:    executions,
		TotalPages: 1, // OSS doesn't support pagination
	}, nil
}
