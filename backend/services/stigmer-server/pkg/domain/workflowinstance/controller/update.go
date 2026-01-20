package workflowinstance

import (
	"context"

	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing workflow instance using the pipeline framework
//
// Pipeline (Stigmer OSS):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing workflow instance from repository to verify it exists
// 4. BuildUpdateState - Merge spec, preserve IDs and status, update audit timestamps
// 5. Persist - Save updated workflow instance to repository
func (c *WorkflowInstanceController) Update(ctx context.Context, instance *workflowinstancev1.WorkflowInstance) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)
	reqCtx.SetNewState(instance)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for workflow instance update
func (c *WorkflowInstanceController) buildUpdatePipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstance] {
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstance]("workflow-instance-update").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstance]()).       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*workflowinstancev1.WorkflowInstance]()).         // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*workflowinstancev1.WorkflowInstance](c.store)). // 3. Load existing instance
		AddStep(steps.NewBuildUpdateStateStep[*workflowinstancev1.WorkflowInstance]()).    // 4. Build updated state (merge spec, preserve status, update audit)
		AddStep(steps.NewPersistStep[*workflowinstancev1.WorkflowInstance](c.store)).      // 5. Persist workflow instance
		Build()
}
