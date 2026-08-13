package workflow

import (
	"context"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes a workflow by ID using the pipeline pattern
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (workflow ID wrapper)
// 2. ExtractResourceId - Extract ID from WorkflowId.Value wrapper
// 3. LoadExistingForDelete - Load workflow from database (stores in context)
// 4. CascadeDeleteInstances - Delete ALL the workflow's instances (see delete_cascade.go)
// 5. DeleteResource - Delete workflow from database
func (c *WorkflowController) Delete(ctx context.Context, workflowId *workflowv1.WorkflowId) (*workflowv1.Workflow, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, workflowId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted workflow from context (set by LoadExistingForDelete step before deletion)
	deletedWorkflow := reqCtx.Get(steps.ExistingResourceKey)
	if deletedWorkflow == nil {
		return nil, grpclib.InternalError(nil, "deleted workflow not found in context")
	}

	return deletedWorkflow.(*workflowv1.Workflow), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
func (c *WorkflowController) buildDeletePipeline() *pipeline.Pipeline[*workflowv1.WorkflowId] {
	return pipeline.NewPipeline[*workflowv1.WorkflowId]("workflow-delete").
		AddStep(steps.NewValidateProtoStep[*workflowv1.WorkflowId]()).                                      // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*workflowv1.WorkflowId]()).                                  // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*workflowv1.WorkflowId, *workflowv1.Workflow](c.store)). // 3. Load workflow
		AddStep(newCascadeDeleteInstancesStep(c.store)).                                                    // 4. Cascade: instances before parent
		AddStep(steps.NewDeleteResourceStep[*workflowv1.WorkflowId](c.store)).                              // 5. Delete from database
		AddStep(steps.NewDeleteSearchIndexStep[*workflowv1.WorkflowId](c.store)).                           // 6. Remove from search index
		Build()
}
