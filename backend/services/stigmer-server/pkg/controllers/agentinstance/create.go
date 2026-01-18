package agentinstance

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Create creates a new agent instance using the pipeline framework
//
// Pipeline:
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. CheckDuplicate - Verify no duplicate exists
// 4. SetDefaults - Set ID, kind, api_version, timestamps
// 5. Persist - Save agent instance to repository
func (c *AgentInstanceController) Create(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for agent instance creation
func (c *AgentInstanceController) buildCreatePipeline() *pipeline.Pipeline[*agentinstancev1.AgentInstance] {
	// Use the ApiResourceKind enum for agent_instance
	kind := apiresourcekind.ApiResourceKind_agent_instance

	return pipeline.NewPipeline[*agentinstancev1.AgentInstance]("agent-instance-create").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.AgentInstance]()).                    // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentinstancev1.AgentInstance]()).                      // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*agentinstancev1.AgentInstance](c.store, kind)).      // 3. Check duplicate
		AddStep(steps.NewSetDefaultsStep[*agentinstancev1.AgentInstance](kind)).                  // 4. Set defaults
		AddStep(steps.NewPersistStep[*agentinstancev1.AgentInstance](c.store, kind)).             // 5. Persist agent instance
		Build()
}
