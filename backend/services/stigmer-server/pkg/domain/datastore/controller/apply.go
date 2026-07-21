package controller

import (
	"context"

	"github.com/rs/zerolog/log"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates a datastore based on whether it already
// exists (declarative apply semantics, delegating to Create or Update —
// the schema-sync gating step runs in whichever pipeline it lands in).
func (c *DatastoreController) Apply(ctx context.Context, datastore *datastorev1.Datastore) (*datastorev1.Datastore, error) {
	reqCtx := pipeline.NewRequestContext(ctx, datastore)

	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	if shouldCreateVal.(bool) {
		log.Info().
			Str("slug", datastore.GetMetadata().GetName()).
			Msg("Datastore does not exist - delegating to CREATE")
		return c.Create(ctx, datastore)
	}

	log.Info().
		Str("slug", datastore.GetMetadata().GetName()).
		Str("id", datastore.GetMetadata().GetId()).
		Msg("Datastore exists - delegating to UPDATE")
	return c.Update(ctx, datastore)
}

// buildApplyPipeline constructs the minimal pipeline that only decides
// create vs update.
func (c *DatastoreController) buildApplyPipeline() *pipeline.Pipeline[*datastorev1.Datastore] {
	return pipeline.NewPipeline[*datastorev1.Datastore]("datastore-apply").
		AddStep(steps.NewValidateProtoStep[*datastorev1.Datastore]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*datastorev1.Datastore]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*datastorev1.Datastore](c.store)). // 3. Check existence
		Build()
}
