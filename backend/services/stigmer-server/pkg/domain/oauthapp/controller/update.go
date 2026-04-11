package oauthapp

import (
	"context"

	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	oauthsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller/steps"
)

// Update updates an existing OAuthApp resource using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (buf.validate)
//  2. ResolveSlug - Generate slug from metadata.name
//  3. LoadExisting - Load existing OAuthApp from repository by ID
//  4. BuildUpdateState - Merge spec from input, preserve ID/slug/org, update audit
//  5. EncryptClientSecret - Encrypt new secret or preserve existing if redacted
//  6. Persist - Save updated OAuthApp to repository
//
// If the client sends ***REDACTED*** as client_secret, the existing encrypted
// value is preserved (the client intended "keep the current secret").
//
// The returned OAuthApp has client_secret replaced with ***REDACTED***.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - Publish step (no event publishing in OSS)
//   - IndexSearch step (OAuthApp is a configuration resource, not user-searchable)
func (c *OAuthAppController) Update(ctx context.Context, app *oauthappv1.OAuthApp) (*oauthappv1.OAuthApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, app)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result := reqCtx.NewState()
	oauthsteps.RedactOAuthApp(result)
	return result, nil
}

// buildUpdatePipeline constructs the pipeline for OAuthApp update.
//
// EncryptClientSecret runs AFTER BuildUpdateState because BuildUpdateState
// replaces NewState with a fresh clone from Input. The encrypt step then
// operates on the merged state, either encrypting a new plaintext secret
// or preserving the existing encrypted value when the redaction marker
// is sent back.
func (c *OAuthAppController) buildUpdatePipeline() *pipeline.Pipeline[*oauthappv1.OAuthApp] {
	return pipeline.NewPipeline[*oauthappv1.OAuthApp]("oauthapp-update").
		AddStep(steps.NewValidateProtoStep[*oauthappv1.OAuthApp]()).                 // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*oauthappv1.OAuthApp]()).                   // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*oauthappv1.OAuthApp](c.store)).           // 3. Load existing OAuthApp
		AddStep(steps.NewBuildUpdateStateStep[*oauthappv1.OAuthApp]()).              // 4. Build updated state
		AddStep(oauthsteps.NewEncryptClientSecretForUpdateStep(c.secretService)).     // 5. Encrypt or preserve client_secret
		AddStep(steps.NewPersistStep[*oauthappv1.OAuthApp](c.store)).               // 6. Persist OAuthApp
		Build()
}
