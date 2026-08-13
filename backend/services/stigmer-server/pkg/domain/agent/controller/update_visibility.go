package agent

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing agent.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
func (c *AgentController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	agent := reqCtx.Get(updateVisibilityAgentKey).(*agentv1.Agent)
	return agent, nil
}

const updateVisibilityAgentKey = "updateVisibilityAgent"

func (c *AgentController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("agent-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadAgentForVisibilityUpdateStep()).
		AddStep(steps.NewValidateVisibilityUpdateStep()). // Reject unsupported levels (after load: NOT_FOUND wins, as in Cloud)
		AddStep(c.newSetAgentVisibilityStep()).
		AddStep(c.newPersistAgentForVisibilityUpdateStep()).
		AddStep(c.newIndexAgentAfterVisibilityUpdateStep()).
		Build()
}

// loadAgentForVisibilityUpdateStep loads the agent by resource_id.
type loadAgentForVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentController) newLoadAgentForVisibilityUpdateStep() *loadAgentForVisibilityUpdateStep {
	return &loadAgentForVisibilityUpdateStep{store: c.store}
}

func (s *loadAgentForVisibilityUpdateStep) Name() string {
	return "LoadAgentForVisibilityUpdate"
}

func (s *loadAgentForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	agent := &agentv1.Agent{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, input.GetResourceId(), agent)
	if err != nil {
		return grpclib.NotFoundError("agent", input.GetResourceId())
	}

	ctx.Set(updateVisibilityAgentKey, agent)
	return nil
}

// setAgentVisibilityStep sets metadata.visibility and updates audit fields.
type setAgentVisibilityStep struct{}

func (c *AgentController) newSetAgentVisibilityStep() *setAgentVisibilityStep {
	return &setAgentVisibilityStep{}
}

func (s *setAgentVisibilityStep) Name() string {
	return "SetAgentVisibility"
}

func (s *setAgentVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	agent := ctx.Get(updateVisibilityAgentKey).(*agentv1.Agent)

	agent.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(agent); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilityAgentKey, agent)
	return nil
}

// persistAgentForVisibilityUpdateStep saves the updated agent.
type persistAgentForVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentController) newPersistAgentForVisibilityUpdateStep() *persistAgentForVisibilityUpdateStep {
	return &persistAgentForVisibilityUpdateStep{store: c.store}
}

func (s *persistAgentForVisibilityUpdateStep) Name() string {
	return "PersistAgentForVisibilityUpdate"
}

func (s *persistAgentForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	agent := ctx.Get(updateVisibilityAgentKey).(*agentv1.Agent)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, agent.GetMetadata().GetId(), agent)
	if err != nil {
		return grpclib.InternalError(err, "failed to save agent")
	}

	return nil
}

// indexAgentAfterVisibilityUpdateStep updates the search index.
type indexAgentAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentController) newIndexAgentAfterVisibilityUpdateStep() *indexAgentAfterVisibilityUpdateStep {
	return &indexAgentAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexAgentAfterVisibilityUpdateStep) Name() string {
	return "IndexAgentAfterVisibilityUpdate"
}

func (s *indexAgentAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	agent := ctx.Get(updateVisibilityAgentKey).(*agentv1.Agent)

	ext := &extractor.AgentExtractor{}
	entry := ext.GetSearchIndexEntry(agent)
	if entry == nil {
		log.Warn().Str("id", agent.Metadata.Id).Msg("IndexAgentAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", agent.Metadata.Id).Msg("IndexAgentAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
