package workflowinstance

import (
	"context"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
)

// Apply creates or updates a workflow instance based on whether it already exists
//
// This implements declarative "apply" semantics (similar to kubectl apply):
// - Checks if resource exists by slug
// - If exists → delegates to Update()
// - If not exists → delegates to Create()
func (c *WorkflowInstanceController) Apply(ctx context.Context, instance *workflowinstancev1.WorkflowInstance) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)

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
			Str("slug", instance.GetMetadata().GetName()).
			Msg("Resource does not exist - delegating to CREATE")
		return c.Create(ctx, instance)
	}

	log.Info().
		Str("slug", instance.GetMetadata().GetName()).
		Str("id", instance.GetMetadata().GetId()).
		Msg("Resource exists - delegating to UPDATE")
	return c.Update(ctx, instance)
}

// buildApplyPipeline constructs the minimal pipeline for apply operations
//
// This pipeline only determines whether to create or update.
// It does NOT perform the actual create/update - that's delegated.
func (c *WorkflowInstanceController) buildApplyPipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstance] {
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstance]("workflow-instance-apply").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstance]()).        // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*workflowinstancev1.WorkflowInstance]()).          // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*workflowinstancev1.WorkflowInstance](c.store)). // 3. Check existence
		Build()
}
