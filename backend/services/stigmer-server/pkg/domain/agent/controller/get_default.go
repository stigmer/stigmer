package agent

import (
	"context"
	"errors"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/defaultagent"
	"google.golang.org/grpc/codes"
)

// GetDefault retrieves the platform default agent.
//
// Resolves the agent labeled stigmer.ai/default-agent: "true" with
// visibility_public. Used by frontends to enable session-first UX
// where users start a conversation without explicitly selecting an agent.
//
// Resolution (candidate set, visibility preference, and the deterministic
// incumbent-wins tie-break) is owned by the defaultagent package — the
// shared implementation behind this RPC and the create-time resolution in
// the session and agentexecution domains.
//
// Pipeline:
// 1. ValidateProto - Validate input (org required)
// 2. LoadDefaultAgent - Resolve via defaultagent.Find
func (c *AgentController) GetDefault(ctx context.Context, req *agentv1.GetDefaultAgentRequest) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetDefaultPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	agent := reqCtx.Get(steps.TargetResourceKey).(*agentv1.Agent)
	return agent, nil
}

func (c *AgentController) buildGetDefaultPipeline() *pipeline.Pipeline[*agentv1.GetDefaultAgentRequest] {
	return pipeline.NewPipeline[*agentv1.GetDefaultAgentRequest]("agent-get-default").
		AddStep(steps.NewValidateProtoStep[*agentv1.GetDefaultAgentRequest]()).
		AddStep(&loadDefaultAgentStep{store: c.store}).
		Build()
}

type loadDefaultAgentStep struct {
	store store.Store
}

func (s *loadDefaultAgentStep) Name() string {
	return "LoadDefaultAgent"
}

func (s *loadDefaultAgentStep) Execute(ctx *pipeline.RequestContext[*agentv1.GetDefaultAgentRequest]) error {
	log.Info().Msg("Resolving platform default agent")

	agent, err := defaultagent.Find(ctx.Context(), s.store)
	switch {
	case errors.Is(err, defaultagent.ErrNotConfigured):
		return grpclib.WrapError(err, codes.NotFound,
			"No default agent available. Ensure an agent with label stigmer.ai/default-agent=true and visibility_public exists")
	case errors.Is(err, defaultagent.ErrNotPublic):
		return grpclib.WrapError(err, codes.FailedPrecondition,
			"Default agent exists but is not visibility_public")
	case err != nil:
		// Store/decode failure — an internal fault, not "no default agent".
		log.Error().Err(err).Msg("Failed to resolve platform default agent")
		return grpclib.WrapError(err, codes.Internal, "failed to resolve the platform default agent")
	}

	log.Info().
		Str("agent_id", agent.GetMetadata().GetId()).
		Str("agent_name", agent.GetMetadata().GetName()).
		Msg("Resolved platform default agent")

	ctx.Set(steps.TargetResourceKey, agent)
	return nil
}
