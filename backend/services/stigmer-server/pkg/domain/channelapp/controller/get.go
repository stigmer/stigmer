package channelapp

import (
	"context"

	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a ChannelApp by id; the secret fields are redacted in the
// response.
func (c *ChannelAppController) Get(ctx context.Context, id *apiresource.ApiResourceId) (*channelappv1.ChannelApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, id)

	if err := c.buildGetPipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	app := reqCtx.Get(steps.TargetResourceKey).(*channelappv1.ChannelApp)
	RedactChannelApp(app)
	return app, nil
}

func (c *ChannelAppController) buildGetPipeline() *pipeline.Pipeline[*apiresource.ApiResourceId] {
	return pipeline.NewPipeline[*apiresource.ApiResourceId]("channelapp-get").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceId]()).
		AddStep(steps.NewLoadTargetStep[*apiresource.ApiResourceId, *channelappv1.ChannelApp](c.store)).
		Build()
}
