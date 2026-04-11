package oauthapp

import (
	"context"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	oauthsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller/steps"
)

// Get retrieves an OAuthApp by ID using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input ApiResourceId (ensures value is not empty)
//  2. LoadTarget - Load OAuthApp from repository by ID, returns NotFound if missing
//
// The loaded OAuthApp has its client_secret redacted before being returned.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
func (c *OAuthAppController) Get(ctx context.Context, id *apiresource.ApiResourceId) (*oauthappv1.OAuthApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, id)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	app := reqCtx.Get(steps.TargetResourceKey).(*oauthappv1.OAuthApp)
	oauthsteps.RedactOAuthApp(app)
	return app, nil
}

func (c *OAuthAppController) buildGetPipeline() *pipeline.Pipeline[*apiresource.ApiResourceId] {
	return pipeline.NewPipeline[*apiresource.ApiResourceId]("oauthapp-get").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceId]()).                           // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*apiresource.ApiResourceId, *oauthappv1.OAuthApp](c.store)). // 2. Load by ID
		Build()
}
