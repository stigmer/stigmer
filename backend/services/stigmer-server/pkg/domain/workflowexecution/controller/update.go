package workflowexecution

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// Update updates an existing workflow execution using the pipeline framework
//
// This handler is for user-initiated configuration updates (spec fields).
// For status updates from workflow-runner, use UpdateStatus() instead.
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing execution from repository by ID
// 4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 5. Persist - Save updated execution to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *WorkflowExecutionController) Update(ctx context.Context, execution *workflowexecutionv1.WorkflowExecution) (*workflowexecutionv1.WorkflowExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, execution)
	reqCtx.SetNewState(execution)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for workflow execution update
func (c *WorkflowExecutionController) buildUpdatePipeline() *pipeline.Pipeline[*workflowexecutionv1.WorkflowExecution] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*workflowexecutionv1.WorkflowExecution]("workflowexecution-update").
		AddStep(steps.NewValidateProtoStep[*workflowexecutionv1.WorkflowExecution]()).            // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*workflowexecutionv1.WorkflowExecution]()).              // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*workflowexecutionv1.WorkflowExecution](c.store)).     // 3. Load existing execution
		AddStep(steps.NewBuildUpdateStateStep[*workflowexecutionv1.WorkflowExecution]()).        // 4. Build updated state
		AddStep(steps.NewPersistStep[*workflowexecutionv1.WorkflowExecution](c.store)).          // 5. Persist execution
		Build()
}
