package workflow

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates a workflow based on whether it already exists
//
// This implements declarative "apply" semantics (similar to kubectl apply):
// - Checks if resource exists by slug
// - If exists → delegates to Update()
// - If not exists → delegates to Create()
func (c *WorkflowController) Apply(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflow)

	// Build and execute minimal apply pipeline
	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Check shouldCreate flag set by LoadForApplyStep
	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	shouldCreate := shouldCreateVal.(bool)

	// Delegate to appropriate handler
	if shouldCreate {
		log.Info().
			Str("slug", workflow.GetMetadata().GetName()).
			Msg("Resource does not exist - delegating to CREATE")
		return c.Create(ctx, workflow)
	}

	log.Info().
		Str("slug", workflow.GetMetadata().GetName()).
		Str("id", workflow.GetMetadata().GetId()).
		Msg("Resource exists - delegating to UPDATE")
	return c.Update(ctx, workflow)
}

// buildApplyPipeline constructs the minimal pipeline for apply operations
//
// This pipeline only determines whether to create or update.
// It does NOT perform the actual create/update - that's delegated.
func (c *WorkflowController) buildApplyPipeline() *pipeline.Pipeline[*workflowv1.Workflow] {
	return pipeline.NewPipeline[*workflowv1.Workflow]("workflow-apply").
		AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]()).        // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*workflowv1.Workflow]()).          // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*workflowv1.Workflow](c.store)).  // 3. Check existence
		Build()
}
