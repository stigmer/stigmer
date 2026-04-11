package oauthapp

import (
	"context"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	oauthsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller/steps"
)

// GetByReference retrieves an OAuthApp by ApiResourceReference (org/slug lookup)
// using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input ApiResourceReference
//  2. LoadByReference - Load OAuthApp by slug (with org filtering)
//
// The loaded OAuthApp has its client_secret redacted before being returned.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (Cloud does post-load FGA auth since input is reference, not ID)
//   - TransformResponse step (no response transformations in OSS)
func (c *OAuthAppController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*oauthappv1.OAuthApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	app := reqCtx.Get(steps.TargetResourceKey).(*oauthappv1.OAuthApp)
	oauthsteps.RedactOAuthApp(app)
	return app, nil
}

func (c *OAuthAppController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("oauthapp-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()). // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*oauthappv1.OAuthApp](c.store)).     // 2. Load by slug
		Build()
}
