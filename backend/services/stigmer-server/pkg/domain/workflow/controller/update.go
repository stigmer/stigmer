package workflow

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)

// Update updates an existing workflow using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing workflow from repository to verify it exists
// 4. BuildUpdateState - Merge spec, preserve IDs and status, update audit timestamps
// 5. Persist - Save updated workflow to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - ValidateWorkflowSpec step (workflow spec validation via Temporal - not yet implemented in OSS)
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *WorkflowController) Update(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflow)
	reqCtx.SetNewState(workflow)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for workflow update
func (c *WorkflowController) buildUpdatePipeline() *pipeline.Pipeline[*workflowv1.Workflow] {
	return pipeline.NewPipeline[*workflowv1.Workflow]("workflow-update").
		AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]()).       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*workflowv1.Workflow]()).         // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*workflowv1.Workflow](c.store)). // 3. Load existing workflow
		AddStep(steps.NewBuildUpdateStateStep[*workflowv1.Workflow]()).    // 4. Build updated state (merge spec, preserve status, update audit)
		AddStep(steps.NewPersistStep[*workflowv1.Workflow](c.store)).      // 5. Persist workflow
		Build()
}
