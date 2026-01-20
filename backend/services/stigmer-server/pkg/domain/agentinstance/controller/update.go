package agentinstance

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
)

// Update updates an existing agent instance using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing agent instance from repository by ID
// 4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 5. Persist - Save updated agent instance to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *AgentInstanceController) Update(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)
	reqCtx.SetNewState(instance)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for agent instance update
func (c *AgentInstanceController) buildUpdatePipeline() *pipeline.Pipeline[*agentinstancev1.AgentInstance] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*agentinstancev1.AgentInstance]("agent-instance-update").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.AgentInstance]()).       // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentinstancev1.AgentInstance]()).         // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*agentinstancev1.AgentInstance](c.store)). // 3. Load existing instance
		AddStep(steps.NewBuildUpdateStateStep[*agentinstancev1.AgentInstance]()).    // 4. Build updated state
		AddStep(steps.NewPersistStep[*agentinstancev1.AgentInstance](c.store)).      // 5. Persist instance
		Build()
}
