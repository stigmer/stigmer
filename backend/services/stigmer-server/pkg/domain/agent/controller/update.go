package agent

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing agent using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing agent from repository by ID
// 4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 5. Persist - Save updated agent to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *AgentController) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, agent)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for agent update
func (c *AgentController) buildUpdatePipeline() *pipeline.Pipeline[*agentv1.Agent] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*agentv1.Agent]("agent-update").
		AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).         // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*agentv1.Agent](c.store)). // 3. Load existing agent
		AddStep(steps.NewBuildUpdateStateStep[*agentv1.Agent]()).    // 4. Build updated state
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).      // 5. Persist agent
		Build()
}
