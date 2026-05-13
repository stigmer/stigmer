package workflowexecution

import (
	"context"

	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ListPendingApprovals returns workflow executions with active human_input
// tasks awaiting reviewer decisions. For OSS, this scans all executions and
// filters for tasks in WORKFLOW_TASK_WAITING_APPROVAL status.
//
// @since T14 (Dashboard Integration)
func (c *WorkflowExecutionController) ListPendingApprovals(
	ctx context.Context,
	req *workflowexecutionv1.ListPendingApprovalsRequest,
) (*workflowexecutionv1.PendingApprovalsList, error) {
	data, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_execution)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list workflow executions for pending approvals")
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var approvals []*workflowexecutionv1.PendingApproval
	for _, d := range data {
		exec := &workflowexecutionv1.WorkflowExecution{}
		if err := proto.Unmarshal(d, exec); err != nil {
			continue
		}

		phase := exec.GetStatus().GetPhase()
		if phase != workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS {
			continue
		}

		for _, task := range exec.GetStatus().GetTasks() {
			if task.GetStatus() != workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL {
				continue
			}

			approval := &workflowexecutionv1.PendingApproval{
				ExecutionId:  exec.GetMetadata().GetId(),
				WorkflowName: exec.GetMetadata().GetName(),
				TaskName:     task.GetTaskId(),
				Requester:    exec.GetStatus().GetAudit().GetSpecAudit().GetCreatedBy().GetId(),
				RequestedAt:  parseTimestampString(task.GetStartedAt()),
			}
			approvals = append(approvals, approval)
		}
	}

	totalCount := int32(len(approvals))

	if len(approvals) > pageSize {
		approvals = approvals[:pageSize]
	}

	return &workflowexecutionv1.PendingApprovalsList{
		Entries:    approvals,
		TotalCount: totalCount,
	}, nil
}

func parseTimestampString(s string) *timestamppb.Timestamp {
	if s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	return timestamppb.New(t)
}
