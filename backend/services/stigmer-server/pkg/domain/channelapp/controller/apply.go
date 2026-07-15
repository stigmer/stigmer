package channelapp

import (
	"context"

	"github.com/rs/zerolog/log"
	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates a ChannelApp based on whether it already exists
// (declarative kubectl-style semantics; the OAuthApp apply shape).
//
// Sending the redaction marker for a secret field on an apply that
// resolves to update preserves the stored value; on an apply that resolves
// to create it is refused — there is nothing to preserve.
func (c *ChannelAppController) Apply(ctx context.Context, app *channelappv1.ChannelApp) (*channelappv1.ChannelApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, app)

	if err := c.buildApplyPipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	if shouldCreateVal.(bool) {
		log.Info().
			Str("slug", app.GetMetadata().GetName()).
			Msg("ChannelApp does not exist - delegating to CREATE")
		return c.Create(ctx, app)
	}

	log.Info().
		Str("slug", app.GetMetadata().GetName()).
		Str("id", app.GetMetadata().GetId()).
		Msg("ChannelApp exists - delegating to UPDATE")
	return c.Update(ctx, app)
}

// buildApplyPipeline constructs the minimal existence-check pipeline; the
// actual create/update is delegated.
func (c *ChannelAppController) buildApplyPipeline() *pipeline.Pipeline[*channelappv1.ChannelApp] {
	return pipeline.NewPipeline[*channelappv1.ChannelApp]("channelapp-apply").
		AddStep(steps.NewValidateProtoStep[*channelappv1.ChannelApp]()).
		AddStep(steps.NewResolveSlugStep[*channelappv1.ChannelApp]()).
		AddStep(steps.NewLoadForApplyStep[*channelappv1.ChannelApp](c.store)).
		Build()
}
