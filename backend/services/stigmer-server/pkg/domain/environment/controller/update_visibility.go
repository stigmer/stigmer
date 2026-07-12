package environment

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing environment.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
//
// Environments cap out at org visibility (kind VisibilityConfig:
// supports_org only): an org-shared environment is usable by executions in
// the owning org, while secret reveal stays creator-only in Cloud.
// public/platform are rejected — secret values must never be resolvable
// across the org boundary. Personal and OAuth-managed environments reject
// org sharing entirely (see envsteps.ShareRestrictionReason).
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - FGA visibility tuple reconciliation (no FGA in OSS)
// The level and share-restriction validations run in BOTH editions from the
// same proto config, keeping the cross-edition error contract identical.
func (c *EnvironmentController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	env := reqCtx.Get(updateVisibilityEnvironmentKey).(*environmentv1.Environment)
	return env, nil
}

const updateVisibilityEnvironmentKey = "updateVisibilityEnvironment"

func (c *EnvironmentController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("environment-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadEnvironmentForVisibilityUpdateStep()).
		AddStep(c.newValidateEnvironmentVisibilityUpdateStep()).
		AddStep(c.newSetEnvironmentVisibilityStep()).
		AddStep(c.newPersistEnvironmentForVisibilityUpdateStep()).
		AddStep(c.newIndexEnvironmentAfterVisibilityUpdateStep()).
		Build()
}

// loadEnvironmentForVisibilityUpdateStep loads the environment by resource_id.
type loadEnvironmentForVisibilityUpdateStep struct {
	store store.Store
}

func (c *EnvironmentController) newLoadEnvironmentForVisibilityUpdateStep() *loadEnvironmentForVisibilityUpdateStep {
	return &loadEnvironmentForVisibilityUpdateStep{store: c.store}
}

func (s *loadEnvironmentForVisibilityUpdateStep) Name() string {
	return "LoadEnvironmentForVisibilityUpdate"
}

func (s *loadEnvironmentForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	env := &environmentv1.Environment{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_environment, input.GetResourceId(), env)
	if err != nil {
		return grpclib.NotFoundError("environment", input.GetResourceId())
	}

	ctx.Set(updateVisibilityEnvironmentKey, env)
	return nil
}

// validateEnvironmentVisibilityUpdateStep rejects unsupported levels and
// share-restricted environments before any state changes.
type validateEnvironmentVisibilityUpdateStep struct{}

func (c *EnvironmentController) newValidateEnvironmentVisibilityUpdateStep() *validateEnvironmentVisibilityUpdateStep {
	return &validateEnvironmentVisibilityUpdateStep{}
}

func (s *validateEnvironmentVisibilityUpdateStep) Name() string {
	return "ValidateEnvironmentVisibilityUpdate"
}

func (s *validateEnvironmentVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	env := ctx.Get(updateVisibilityEnvironmentKey).(*environmentv1.Environment)

	requested := input.GetVisibility()

	supported, err := apiresource.SupportsVisibility(apiresourcekind.ApiResourceKind_environment, requested)
	if err != nil {
		return grpclib.InternalError(err, "failed to resolve environment visibility config")
	}
	if !supported {
		return grpclib.InvalidArgumentError(
			"visibility level %s is not supported for environments - secret values never leave the org boundary (supported: private, org)",
			requested.String())
	}

	// Only gate the transitions that widen access. Restoring a
	// share-restricted environment to private must always be possible.
	if requested == apiresourcepb.ApiResourceVisibility_visibility_org {
		if reason := envsteps.ShareRestrictionReason(env.GetMetadata()); reason != "" {
			return grpclib.FailedPreconditionError("%s", reason)
		}
	}

	return nil
}

// setEnvironmentVisibilityStep sets metadata.visibility and updates audit fields.
type setEnvironmentVisibilityStep struct{}

func (c *EnvironmentController) newSetEnvironmentVisibilityStep() *setEnvironmentVisibilityStep {
	return &setEnvironmentVisibilityStep{}
}

func (s *setEnvironmentVisibilityStep) Name() string {
	return "SetVisibility"
}

func (s *setEnvironmentVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	env := ctx.Get(updateVisibilityEnvironmentKey).(*environmentv1.Environment)

	env.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(env); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilityEnvironmentKey, env)
	return nil
}

// persistEnvironmentForVisibilityUpdateStep saves the updated environment.
type persistEnvironmentForVisibilityUpdateStep struct {
	store store.Store
}

func (c *EnvironmentController) newPersistEnvironmentForVisibilityUpdateStep() *persistEnvironmentForVisibilityUpdateStep {
	return &persistEnvironmentForVisibilityUpdateStep{store: c.store}
}

func (s *persistEnvironmentForVisibilityUpdateStep) Name() string {
	return "PersistEnvironmentForVisibilityUpdate"
}

func (s *persistEnvironmentForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	env := ctx.Get(updateVisibilityEnvironmentKey).(*environmentv1.Environment)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_environment, env.GetMetadata().GetId(), env)
	if err != nil {
		return grpclib.InternalError(err, "failed to save environment")
	}

	return nil
}

// indexEnvironmentAfterVisibilityUpdateStep updates the search index.
type indexEnvironmentAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *EnvironmentController) newIndexEnvironmentAfterVisibilityUpdateStep() *indexEnvironmentAfterVisibilityUpdateStep {
	return &indexEnvironmentAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexEnvironmentAfterVisibilityUpdateStep) Name() string {
	return "IndexEnvironmentAfterVisibilityUpdate"
}

func (s *indexEnvironmentAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	env := ctx.Get(updateVisibilityEnvironmentKey).(*environmentv1.Environment)

	ext := &extractor.EnvironmentExtractor{}
	entry := ext.GetSearchIndexEntry(env)
	if entry == nil {
		log.Warn().Str("id", env.Metadata.Id).Msg("IndexEnvironmentAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_environment, env.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", env.Metadata.Id).Msg("IndexEnvironmentAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
