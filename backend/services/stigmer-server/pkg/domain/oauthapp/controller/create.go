package oauthapp

import (
	"context"

	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	oauthsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller/steps"
)

// Create creates a new OAuthApp resource using the pipeline framework.
//
// Pipeline Steps:
//  1. ResolveSlug - Generate slug from metadata.name (if not already set)
//  2. ValidateProto - Validate proto field constraints (buf.validate)
//     - api_version must be "iam.stigmer.ai/v1"
//     - kind must be "OAuthApp"
//     - client_id, client_secret, authorization_url, token_url are required
//  3. CheckDuplicate - Verify no duplicate exists by slug (within org)
//  4. EncryptClientSecret - AES-256-GCM encrypt client_secret before persist
//  5. BuildNewState - Generate ID (oap_{ulid}), clear status, set audit fields
//  6. Persist - Save OAuthApp to repository
//
// The returned OAuthApp has client_secret replaced with ***REDACTED***.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - CreateIamPolicies step (no IAM/FGA in OSS)
//   - Publish step (no event publishing in OSS)
//   - IndexSearch step (OAuthApp is a configuration resource, not user-searchable)
func (c *OAuthAppController) Create(ctx context.Context, app *oauthappv1.OAuthApp) (*oauthappv1.OAuthApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, app)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result := reqCtx.NewState()
	oauthsteps.RedactOAuthApp(result)
	return result, nil
}

// buildCreatePipeline constructs the pipeline for OAuthApp creation.
//
// ResolveSlug runs before ValidateProto so that clients can omit the slug
// and have it derived from metadata.name before field constraints are checked.
//
// EncryptClientSecret runs before BuildNewState because BuildNewState clones
// the current state -- the encrypted value must be in place before the clone.
func (c *OAuthAppController) buildCreatePipeline() *pipeline.Pipeline[*oauthappv1.OAuthApp] {
	return pipeline.NewPipeline[*oauthappv1.OAuthApp]("oauthapp-create").
		AddStep(steps.NewResolveSlugStep[*oauthappv1.OAuthApp]()).                   // 1. Resolve slug
		AddStep(steps.NewValidateProtoStep[*oauthappv1.OAuthApp]()).                 // 2. Validate field constraints
		AddStep(steps.NewCheckDuplicateStep[*oauthappv1.OAuthApp](c.store)).         // 3. Check duplicate
		AddStep(oauthsteps.NewEncryptClientSecretForCreateStep(c.secretService)).     // 4. Encrypt client_secret
		AddStep(steps.NewBuildNewStateStep[*oauthappv1.OAuthApp]()).                 // 5. Build new state
		AddStep(steps.NewPersistStep[*oauthappv1.OAuthApp](c.store)).               // 6. Persist OAuthApp
		Build()
}
