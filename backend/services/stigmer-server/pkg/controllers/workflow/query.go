package workflow

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Get retrieves a workflow by ID using the pipeline framework
func (c *WorkflowController) Get(ctx context.Context, workflowId *workflowv1.WorkflowId) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflowId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded workflow from context
	workflow := reqCtx.Get(steps.TargetResourceKey).(*workflowv1.Workflow)
	return workflow, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
func (c *WorkflowController) buildGetPipeline() *pipeline.Pipeline[*workflowv1.WorkflowId] {
	return pipeline.NewPipeline[*workflowv1.WorkflowId]("workflow-get").
		AddStep(steps.NewValidateProtoStep[*workflowv1.WorkflowId]()).                      // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*workflowv1.WorkflowId, *workflowv1.Workflow](c.store)). // 2. Load by ID
		Build()
}

// GetByReference retrieves a workflow by ApiResourceReference (slug-based lookup) using the pipeline framework
func (c *WorkflowController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded workflow from context
	workflow := reqCtx.Get(steps.TargetResourceKey).(*workflowv1.Workflow)
	return workflow, nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations
func (c *WorkflowController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("workflow-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()). // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*workflowv1.Workflow](c.store)).      // 2. Load by slug
		Build()
}
