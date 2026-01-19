package workflowinstance

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
)

// Update updates an existing workflow instance using the pipeline framework
//
// Pipeline (Stigmer OSS):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. Persist - Save updated workflow instance to repository
func (c *WorkflowInstanceController) Update(ctx context.Context, instance *workflowinstancev1.WorkflowInstance) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for workflow instance update
func (c *WorkflowInstanceController) buildUpdatePipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstance] {
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstance]("workflow-instance-update").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstance]()). // 1. Validate field constraints
		AddStep(steps.NewPersistStep[*workflowinstancev1.WorkflowInstance](c.store)). // 2. Persist workflow instance
		Build()
}
