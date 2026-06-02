package workflow

import (
	"context"
	"errors"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// GetVersion retrieves a specific historical version of a workflow by its content hash.
//
// Used by:
// - TS runner during hydration (to get the exact YAML that should execute)
// - Execution viewer (to render the correct graph for historical executions)
func (c *WorkflowController) GetVersion(ctx context.Context, req *workflowv1.GetWorkflowVersionInput) (*workflowv1.WorkflowVersionEntry, error) {
	if req.WorkflowId == "" {
		return nil, grpclib.InvalidArgumentError("workflow_id is required")
	}
	if req.VersionHash == "" {
		return nil, grpclib.InvalidArgumentError("version_hash is required")
	}

	// First check if the requested hash matches the current (live) workflow.
	// This avoids an audit lookup for the common case of recent executions.
	var currentWorkflow workflowv1.Workflow
	err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_workflow, req.WorkflowId, &currentWorkflow)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, grpclib.NotFoundError("workflow", req.WorkflowId)
		}
		return nil, grpclib.InternalError(err, "failed to load workflow")
	}

	if currentWorkflow.GetStatus().GetVersionHash() == req.VersionHash {
		return mapWorkflowToVersionEntry(&currentWorkflow, true), nil
	}

	// Hash doesn't match current — look up in audit history
	var archivedWorkflow workflowv1.Workflow
	err = c.store.GetAuditByHash(
		ctx,
		apiresourcekind.ApiResourceKind_workflow,
		req.WorkflowId,
		req.VersionHash,
		&archivedWorkflow,
	)
	if err != nil {
		if errors.Is(err, store.ErrAuditNotFound) {
			return nil, grpclib.NotFoundError("workflow version", req.VersionHash[:12]+"...")
		}
		return nil, grpclib.InternalError(err, "failed to load workflow version from audit")
	}

	return mapWorkflowToVersionEntry(&archivedWorkflow, false), nil
}
