package skill

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing skill.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
func (c *SkillController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*skillv1.Skill, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	skill := reqCtx.Get(updateVisibilitySkillKey).(*skillv1.Skill)
	return skill, nil
}

const updateVisibilitySkillKey = "updateVisibilitySkill"

func (c *SkillController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("skill-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadSkillForVisibilityUpdateStep()).
		AddStep(steps.NewValidateVisibilityUpdateStep()). // Reject unsupported levels (after load: NOT_FOUND wins, as in Cloud)
		AddStep(c.newSetVisibilityStep()).
		AddStep(c.newPersistSkillForVisibilityUpdateStep()).
		AddStep(c.newIndexSkillAfterVisibilityUpdateStep()).
		Build()
}

// loadSkillForVisibilityUpdateStep loads the skill by resource_id.
type loadSkillForVisibilityUpdateStep struct {
	store store.Store
}

func (c *SkillController) newLoadSkillForVisibilityUpdateStep() *loadSkillForVisibilityUpdateStep {
	return &loadSkillForVisibilityUpdateStep{store: c.store}
}

func (s *loadSkillForVisibilityUpdateStep) Name() string {
	return "LoadSkillForVisibilityUpdate"
}

func (s *loadSkillForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	skill := &skillv1.Skill{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_skill, input.GetResourceId(), skill)
	if err != nil {
		return grpclib.NotFoundError("skill", input.GetResourceId())
	}

	ctx.Set(updateVisibilitySkillKey, skill)
	return nil
}

// setVisibilityStep sets metadata.visibility and updates audit fields.
type setVisibilityStep struct{}

func (c *SkillController) newSetVisibilityStep() *setVisibilityStep {
	return &setVisibilityStep{}
}

func (s *setVisibilityStep) Name() string {
	return "SetVisibility"
}

func (s *setVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	skill := ctx.Get(updateVisibilitySkillKey).(*skillv1.Skill)

	skill.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(skill); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilitySkillKey, skill)
	return nil
}

// persistSkillForVisibilityUpdateStep saves the updated skill.
type persistSkillForVisibilityUpdateStep struct {
	store store.Store
}

func (c *SkillController) newPersistSkillForVisibilityUpdateStep() *persistSkillForVisibilityUpdateStep {
	return &persistSkillForVisibilityUpdateStep{store: c.store}
}

func (s *persistSkillForVisibilityUpdateStep) Name() string {
	return "PersistSkillForVisibilityUpdate"
}

func (s *persistSkillForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	skill := ctx.Get(updateVisibilitySkillKey).(*skillv1.Skill)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_skill, skill.GetMetadata().GetId(), skill)
	if err != nil {
		return grpclib.InternalError(err, "failed to save skill")
	}

	return nil
}

// indexSkillAfterVisibilityUpdateStep updates the search index.
type indexSkillAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *SkillController) newIndexSkillAfterVisibilityUpdateStep() *indexSkillAfterVisibilityUpdateStep {
	return &indexSkillAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexSkillAfterVisibilityUpdateStep) Name() string {
	return "IndexSkillAfterVisibilityUpdate"
}

func (s *indexSkillAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	skill := ctx.Get(updateVisibilitySkillKey).(*skillv1.Skill)

	ext := &extractor.SkillExtractor{}
	entry := ext.GetSearchIndexEntry(skill)
	if entry == nil {
		log.Warn().Str("id", skill.Metadata.Id).Msg("IndexSkillAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_skill, skill.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", skill.Metadata.Id).Msg("IndexSkillAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
