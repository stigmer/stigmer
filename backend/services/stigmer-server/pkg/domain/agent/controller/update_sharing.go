package agent

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// UpdateSharing updates the sharing configuration of an existing agent.
//
// This is a targeted spec update — it only modifies spec.sharing, leaving
// the rest of the spec, metadata, and status untouched. Mirrors the
// UpdateVisibility pattern: console and CLI toggle sharing through this RPC
// instead of a full-resource write, avoiding read-modify-write races.
//
// Sharing gates the public getSharedProfile resolution path; it writes no
// FGA tuples in any edition (see AgentSharing in spec.proto).
func (c *AgentController) UpdateSharing(
	ctx context.Context,
	input *agentv1.UpdateAgentSharingInput,
) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateSharingPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	agent := reqCtx.Get(updateSharingAgentKey).(*agentv1.Agent)
	return agent, nil
}

const updateSharingAgentKey = "updateSharingAgent"

func (c *AgentController) buildUpdateSharingPipeline() *pipeline.Pipeline[*agentv1.UpdateAgentSharingInput] {
	return pipeline.NewPipeline[*agentv1.UpdateAgentSharingInput]("agent-update-sharing").
		AddStep(steps.NewValidateProtoStep[*agentv1.UpdateAgentSharingInput]()).
		AddStep(c.newLoadAgentForSharingUpdateStep()).
		AddStep(c.newSetAgentSharingStep()).
		AddStep(c.newPersistAgentForSharingUpdateStep()).
		Build()
}

// loadAgentForSharingUpdateStep loads the agent by resource_id.
type loadAgentForSharingUpdateStep struct {
	store store.Store
}

func (c *AgentController) newLoadAgentForSharingUpdateStep() *loadAgentForSharingUpdateStep {
	return &loadAgentForSharingUpdateStep{store: c.store}
}

func (s *loadAgentForSharingUpdateStep) Name() string {
	return "LoadAgentForSharingUpdate"
}

func (s *loadAgentForSharingUpdateStep) Execute(ctx *pipeline.RequestContext[*agentv1.UpdateAgentSharingInput]) error {
	input := ctx.Input()

	agent := &agentv1.Agent{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, input.GetResourceId(), agent)
	if err != nil {
		return grpclib.NotFoundError("agent", input.GetResourceId())
	}

	ctx.Set(updateSharingAgentKey, agent)
	return nil
}

// setAgentSharingStep sets spec.sharing and updates audit fields.
type setAgentSharingStep struct{}

func (c *AgentController) newSetAgentSharingStep() *setAgentSharingStep {
	return &setAgentSharingStep{}
}

func (s *setAgentSharingStep) Name() string {
	return "SetAgentSharing"
}

func (s *setAgentSharingStep) Execute(ctx *pipeline.RequestContext[*agentv1.UpdateAgentSharingInput]) error {
	input := ctx.Input()
	agent := ctx.Get(updateSharingAgentKey).(*agentv1.Agent)

	if agent.Spec == nil {
		agent.Spec = &agentv1.AgentSpec{}
	}
	agent.Spec.Sharing = input.GetSharing()

	if err := steps.SetAuditFieldsForUpdate(agent); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateSharingAgentKey, agent)
	return nil
}

// persistAgentForSharingUpdateStep saves the updated agent.
type persistAgentForSharingUpdateStep struct {
	store store.Store
}

func (c *AgentController) newPersistAgentForSharingUpdateStep() *persistAgentForSharingUpdateStep {
	return &persistAgentForSharingUpdateStep{store: c.store}
}

func (s *persistAgentForSharingUpdateStep) Name() string {
	return "PersistAgentForSharingUpdate"
}

func (s *persistAgentForSharingUpdateStep) Execute(ctx *pipeline.RequestContext[*agentv1.UpdateAgentSharingInput]) error {
	agent := ctx.Get(updateSharingAgentKey).(*agentv1.Agent)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, agent.GetMetadata().GetId(), agent)
	if err != nil {
		return grpclib.InternalError(err, "failed to save agent")
	}

	return nil
}
