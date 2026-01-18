package agent

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// Update updates an existing agent using the pipeline framework
func (c *AgentController) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, agent)

	p := pipeline.NewPipeline[*agentv1.Agent]("agent-update").
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent")).
		// TODO: Add Publish step when event system is ready
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}
