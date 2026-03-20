package agent

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/codes"
)

// GetDefault retrieves the platform default agent.
//
// Resolves the agent labeled stigmer.ai/default-agent: "true" with
// visibility_public. Used by frontends to enable session-first UX
// where users start a conversation without explicitly selecting an agent.
//
// Pipeline:
// 1. ValidateProto - Validate input (org required)
// 2. LoadDefaultAgent - Load platform default agent by label + visibility check
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

	defaultAgent := &agentv1.Agent{}
	err := s.store.FindByLabel(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_agent,
		"stigmer.ai/default-agent", "true",
		defaultAgent,
	)
	if err != nil {
		log.Error().Err(err).Msg("Failed to find platform default agent")
		return grpclib.WrapError(
			fmt.Errorf("no default agent available on this platform: %w", err),
			codes.NotFound,
			"No default agent available. Ensure an agent with label stigmer.ai/default-agent=true and visibility_public exists",
		)
	}

	if defaultAgent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		return grpclib.WrapError(
			fmt.Errorf("default agent is not publicly accessible"),
			codes.FailedPrecondition,
			"Default agent exists but is not visibility_public",
		)
	}

	log.Info().
		Str("agent_id", defaultAgent.GetMetadata().GetId()).
		Str("agent_name", defaultAgent.GetMetadata().GetName()).
		Msg("Resolved platform default agent")

	ctx.Set(steps.TargetResourceKey, defaultAgent)
	return nil
}
