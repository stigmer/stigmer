package channelapp

import (
	"context"

	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing ChannelApp resource using the pipeline
// framework.
//
// Pipeline steps:
//  1. ValidateProto - buf.validate constraints
//  2. ResolveSlug - derive slug from metadata.name
//  3. LoadExisting - load the stored ChannelApp by id
//  4. ValidateProviderImmutable - the provider arm cannot change
//  5. BuildUpdateState - merge spec, preserve id/slug/org, update audit
//  6. EncryptChannelAppSecrets - encrypt new plaintext values; the
//     redaction marker preserves the stored value PER FIELD (one request
//     may rotate one secret while keeping the other)
//  7. Persist - save to the store
//
// The returned ChannelApp has both secret fields redacted.
func (c *ChannelAppController) Update(ctx context.Context, app *channelappv1.ChannelApp) (*channelappv1.ChannelApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, app)

	if err := c.buildUpdatePipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	result := reqCtx.NewState()
	RedactChannelApp(result)
	return result, nil
}

// buildUpdatePipeline constructs the pipeline for ChannelApp update.
//
// EncryptChannelAppSecrets runs AFTER BuildUpdateState because
// BuildUpdateState replaces NewState with a fresh clone from Input; the
// encrypt step then operates on the merged state (the oauthapp ordering).
func (c *ChannelAppController) buildUpdatePipeline() *pipeline.Pipeline[*channelappv1.ChannelApp] {
	return pipeline.NewPipeline[*channelappv1.ChannelApp]("channelapp-update").
		AddStep(steps.NewValidateProtoStep[*channelappv1.ChannelApp]()).
		AddStep(steps.NewResolveSlugStep[*channelappv1.ChannelApp]()).
		AddStep(steps.NewLoadExistingStep[*channelappv1.ChannelApp](c.store)).
		AddStep(&validateProviderImmutableStep{}).
		AddStep(steps.NewBuildUpdateStateStep[*channelappv1.ChannelApp]()).
		AddStep(NewEncryptChannelAppSecretsForUpdateStep(c.secretService)).
		AddStep(steps.NewPersistStep[*channelappv1.ChannelApp](c.store)).
		Build()
}
