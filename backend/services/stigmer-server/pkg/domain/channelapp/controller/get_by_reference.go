package channelapp

import (
	"context"

	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves a ChannelApp by org/slug reference; the secret
// fields are redacted in the response.
//
// Note: compared to Stigmer Cloud, OSS excludes the post-load FGA
// authorization step (single-user local posture).
func (c *ChannelAppController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*channelappv1.ChannelApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	if err := c.buildGetByReferencePipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	app := reqCtx.Get(steps.TargetResourceKey).(*channelappv1.ChannelApp)
	RedactChannelApp(app)
	return app, nil
}

func (c *ChannelAppController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("channelapp-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(steps.NewLoadByReferenceStep[*channelappv1.ChannelApp](c.store)).
		Build()
}
