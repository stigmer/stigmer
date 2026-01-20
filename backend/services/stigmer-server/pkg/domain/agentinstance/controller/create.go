package agentinstance

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
)

// Create creates a new agent instance using the pipeline framework
//
// Pipeline:
// 1. ResolveSlug - Generate slug from metadata.name (must be before validation)
// 2. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 3. CheckDuplicate - Verify no duplicate exists
// 4. SetDefaults - Set ID, kind, api_version, timestamps
// 5. Persist - Save agent instance to repository
func (c *AgentInstanceController) Create(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)
	reqCtx.SetNewState(instance)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for agent instance creation
func (c *AgentInstanceController) buildCreatePipeline() *pipeline.Pipeline[*agentinstancev1.AgentInstance] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*agentinstancev1.AgentInstance]("agent-instance-create").
		AddStep(steps.NewResolveSlugStep[*agentinstancev1.AgentInstance]()).           // 1. Resolve slug (must be before validation)
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.AgentInstance]()).         // 2. Validate field constraints
		AddStep(steps.NewCheckDuplicateStep[*agentinstancev1.AgentInstance](c.store)). // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*agentinstancev1.AgentInstance]()).         // 4. Build new state
		AddStep(steps.NewPersistStep[*agentinstancev1.AgentInstance](c.store)).        // 5. Persist agent instance
		Build()
}
