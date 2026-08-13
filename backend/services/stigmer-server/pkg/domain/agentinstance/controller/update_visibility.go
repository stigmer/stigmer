package agentinstance

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing agent instance.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
func (c *AgentInstanceController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*agentinstancev1.AgentInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	instance := reqCtx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)
	return instance, nil
}

const updateVisibilityInstanceKey = "updateVisibilityInstance"

func (c *AgentInstanceController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("agent-instance-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadInstanceForVisibilityUpdateStep()).
		AddStep(steps.NewValidateVisibilityUpdateStep()). // Reject unsupported levels (after load: NOT_FOUND wins, as in Cloud)
		AddStep(c.newSetInstanceVisibilityStep()).
		AddStep(c.newPersistInstanceForVisibilityUpdateStep()).
		AddStep(c.newIndexInstanceAfterVisibilityUpdateStep()).
		Build()
}

// loadInstanceForVisibilityUpdateStep loads the agent instance by resource_id.
type loadInstanceForVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentInstanceController) newLoadInstanceForVisibilityUpdateStep() *loadInstanceForVisibilityUpdateStep {
	return &loadInstanceForVisibilityUpdateStep{store: c.store}
}

func (s *loadInstanceForVisibilityUpdateStep) Name() string {
	return "LoadInstanceForVisibilityUpdate"
}

func (s *loadInstanceForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	instance := &agentinstancev1.AgentInstance{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, input.GetResourceId(), instance)
	if err != nil {
		return grpclib.NotFoundError("agent instance", input.GetResourceId())
	}

	ctx.Set(updateVisibilityInstanceKey, instance)
	return nil
}

// setInstanceVisibilityStep sets metadata.visibility and updates audit fields.
type setInstanceVisibilityStep struct{}

func (c *AgentInstanceController) newSetInstanceVisibilityStep() *setInstanceVisibilityStep {
	return &setInstanceVisibilityStep{}
}

func (s *setInstanceVisibilityStep) Name() string {
	return "SetInstanceVisibility"
}

func (s *setInstanceVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	instance := ctx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)

	instance.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(instance); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilityInstanceKey, instance)
	return nil
}

// persistInstanceForVisibilityUpdateStep saves the updated agent instance.
type persistInstanceForVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentInstanceController) newPersistInstanceForVisibilityUpdateStep() *persistInstanceForVisibilityUpdateStep {
	return &persistInstanceForVisibilityUpdateStep{store: c.store}
}

func (s *persistInstanceForVisibilityUpdateStep) Name() string {
	return "PersistInstanceForVisibilityUpdate"
}

func (s *persistInstanceForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	instance := ctx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instance.GetMetadata().GetId(), instance)
	if err != nil {
		return grpclib.InternalError(err, "failed to save agent instance")
	}

	return nil
}

// indexInstanceAfterVisibilityUpdateStep updates the search index.
type indexInstanceAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentInstanceController) newIndexInstanceAfterVisibilityUpdateStep() *indexInstanceAfterVisibilityUpdateStep {
	return &indexInstanceAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexInstanceAfterVisibilityUpdateStep) Name() string {
	return "IndexInstanceAfterVisibilityUpdate"
}

func (s *indexInstanceAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	instance := ctx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)

	ext := &extractor.AgentInstanceExtractor{}
	entry := ext.GetSearchIndexEntry(instance)
	if entry == nil {
		log.Warn().Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instance.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
