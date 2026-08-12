package channelapp

import (
	"context"

	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Create creates a new ChannelApp resource using the pipeline framework.
//
// Pipeline steps:
//  1. ResolveSlug - derive slug from metadata.name when not set
//  2. ValidateProto - buf.validate constraints (provider oneof required;
//     the Slack arm's client_id/client_secret/signing_secret required)
//  3. CheckDuplicate - no duplicate by slug within the org
//  4. EncryptChannelAppSecrets - AES-256-GCM encrypt both secrets;
//     the redaction marker is refused on create
//  5. BuildNewState - generate id (chapp_{ulid}), clear status, set audit,
//     default visibility
//  6. Persist - save to the store
//
// The returned ChannelApp has both secret fields redacted.
//
// Note: compared to Stigmer Cloud, OSS excludes the Authorize,
// CreateIamPolicies, and Publish steps (single-user local posture); the
// kind is not search-indexed in either edition.
func (c *ChannelAppController) Create(ctx context.Context, app *channelappv1.ChannelApp) (*channelappv1.ChannelApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, app)

	if err := c.buildCreatePipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	result := reqCtx.NewState()
	RedactChannelApp(result)
	return result, nil
}

// buildCreatePipeline constructs the pipeline for ChannelApp creation.
//
// EncryptChannelAppSecrets runs before BuildNewState because BuildNewState
// clones the current state — the encrypted values must be in place before
// the clone (the oauthapp ordering).
func (c *ChannelAppController) buildCreatePipeline() *pipeline.Pipeline[*channelappv1.ChannelApp] {
	return pipeline.NewPipeline[*channelappv1.ChannelApp]("channelapp-create").
		AddStep(steps.NewResolveSlugStep[*channelappv1.ChannelApp]()).
		AddStep(steps.NewValidateProtoStep[*channelappv1.ChannelApp]()).
		AddStep(steps.NewCheckDuplicateStep[*channelappv1.ChannelApp](c.store)).
		AddStep(NewEncryptChannelAppSecretsForCreateStep(c.secretService)).
		AddStep(steps.NewBuildNewStateStep[*channelappv1.ChannelApp]()).
		AddStep(steps.NewPersistStep[*channelappv1.ChannelApp](c.store)).
		Build()
}
