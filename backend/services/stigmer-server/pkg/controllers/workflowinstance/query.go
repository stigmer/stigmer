package workflowinstance

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Get retrieves a workflow instance by ID using the pipeline framework
func (c *WorkflowInstanceController) Get(ctx context.Context, workflowInstanceId *workflowinstancev1.WorkflowInstanceId) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflowInstanceId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded workflow instance from context
	workflowInstance := reqCtx.Get(steps.TargetResourceKey).(*workflowinstancev1.WorkflowInstance)
	return workflowInstance, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
func (c *WorkflowInstanceController) buildGetPipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstanceId] {
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstanceId]("workflow-instance-get").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstanceId]()).                              // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*workflowinstancev1.WorkflowInstanceId, *workflowinstancev1.WorkflowInstance](c.store)). // 2. Load by ID
		Build()
}

// GetByReference retrieves a workflow instance by ApiResourceReference (slug-based lookup) using the pipeline framework
func (c *WorkflowInstanceController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded workflow instance from context
	workflowInstance := reqCtx.Get(steps.TargetResourceKey).(*workflowinstancev1.WorkflowInstance)
	return workflowInstance, nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations
func (c *WorkflowInstanceController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("workflow-instance-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).         // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*workflowinstancev1.WorkflowInstance](c.store)). // 2. Load by slug
		Build()
}
