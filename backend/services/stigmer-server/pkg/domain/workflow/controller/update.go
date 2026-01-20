package workflow

import (
	"context"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing workflow using the pipeline framework
//
// Pipeline (Stigmer OSS):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate (Layer 1)
// 2. ValidateWorkflowSpec - Validate workflow via Temporal (Layer 2: Go converts + validates - SSOT)
// 3. ResolveSlug - Generate slug from metadata.name
// 4. LoadExisting - Load existing workflow from repository to verify it exists
// 5. BuildUpdateState - Merge spec, preserve IDs and status, update audit timestamps
// 6. Persist - Save updated workflow to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *WorkflowController) Update(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflow)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for workflow update
func (c *WorkflowController) buildUpdatePipeline() *pipeline.Pipeline[*workflowv1.Workflow] {
	return pipeline.NewPipeline[*workflowv1.Workflow]("workflow-update").
		AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]()).       // 1. Validate field constraints (Layer 1)
		AddStep(newValidateWorkflowSpecStep(c.validator)).                 // 2. Validate via Temporal (Layer 2: Go converts + validates - SSOT)
		AddStep(steps.NewResolveSlugStep[*workflowv1.Workflow]()).         // 3. Resolve slug
		AddStep(steps.NewLoadExistingStep[*workflowv1.Workflow](c.store)). // 4. Load existing workflow
		AddStep(steps.NewBuildUpdateStateStep[*workflowv1.Workflow]()).    // 5. Build updated state (merge spec, preserve status, update audit)
		AddStep(steps.NewPersistStep[*workflowv1.Workflow](c.store)).      // 6. Persist workflow
		Build()
}
