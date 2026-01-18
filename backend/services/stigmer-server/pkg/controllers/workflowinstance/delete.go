package workflowinstance

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowinstance/v1"
)

// Delete deletes a workflow instance by ID using the pipeline pattern
func (c *WorkflowInstanceController) Delete(ctx context.Context, workflowInstanceId *workflowinstancev1.WorkflowInstanceId) (*workflowinstancev1.WorkflowInstance, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, workflowInstanceId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted workflow instance from context
	deletedWorkflowInstance := reqCtx.Get(steps.ExistingResourceKey)
	if deletedWorkflowInstance == nil {
		return nil, grpclib.InternalError(nil, "deleted workflow instance not found in context")
	}

	return deletedWorkflowInstance.(*workflowinstancev1.WorkflowInstance), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
func (c *WorkflowInstanceController) buildDeletePipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstanceId] {
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstanceId]("workflow-instance-delete").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstanceId]()).                                        // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*workflowinstancev1.WorkflowInstanceId]()).                                    // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*workflowinstancev1.WorkflowInstanceId, *workflowinstancev1.WorkflowInstance](c.store)). // 3. Load workflow instance
		AddStep(steps.NewDeleteResourceStep[*workflowinstancev1.WorkflowInstanceId](c.store)).                                // 4. Delete from database
		Build()
}
