package workflowexecution

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// Get retrieves a workflow execution by ID using the pipeline framework
//
// This implements the standard Get operation pattern:
// 1. ValidateProto - Validate input WorkflowExecutionId (ensures value is not empty)
// 2. LoadTarget - Load execution from repository by ID
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on WorkflowExecutionId
// - LoadTarget: Loads execution from BadgerDB by ID, returns NotFound if missing
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - ExtractResourceId step (not needed - ID is already in WorkflowExecutionId.value)
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// The loaded execution is stored in context with key "targetResource" and
// returned by the handler.
func (c *WorkflowExecutionController) Get(ctx context.Context, id *workflowexecutionv1.WorkflowExecutionId) (*workflowexecutionv1.WorkflowExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, id)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded execution from context
	execution := reqCtx.Get(steps.TargetResourceKey).(*workflowexecutionv1.WorkflowExecution)
	return execution, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *WorkflowExecutionController) buildGetPipeline() *pipeline.Pipeline[*workflowexecutionv1.WorkflowExecutionId] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*workflowexecutionv1.WorkflowExecutionId]("workflowexecution-get").
		AddStep(steps.NewValidateProtoStep[*workflowexecutionv1.WorkflowExecutionId]()).                              // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*workflowexecutionv1.WorkflowExecutionId, *workflowexecutionv1.WorkflowExecution](c.store)). // 2. Load by ID
		Build()
}
