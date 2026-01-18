package agent

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agent/steps"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// Context keys for inter-step communication
const (
	DefaultInstanceIDKey = "default_instance_id"
)

// Create creates a new agent using the pipeline framework
//
// Pipeline (aligned with Stigmer Cloud AgentCreateHandler):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. Authorize - Verify caller has permission (TODO: when auth ready)
// 3. ResolveSlug - Generate slug from metadata.name
// 4. CheckDuplicate - Verify no duplicate exists
// 5. SetDefaults - Set ID, kind, api_version, timestamps
// 6. Persist - Save agent to repository
// 7. CreateIamPolicies - Establish ownership relationships (TODO: when IAM ready)
// 8. CreateDefaultInstance - Create default agent instance (TODO: when AgentInstance ready)
// 9. UpdateAgentStatusWithDefaultInstance - Update agent status with default_instance_id (TODO: when AgentInstance ready)
// 10. Publish - Publish event (TODO: when event system ready)
// 11. TransformResponse - Apply response transformations (TODO: if needed)
// 12. SendResponse - Return created agent (implicit via return statement)
func (c *AgentController) Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, agent)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for agent creation
func (c *AgentController) buildCreatePipeline() *pipeline.Pipeline[*agentv1.Agent] {
	return pipeline.NewPipeline[*agentv1.Agent]("agent-create").
		AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).                         // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).                           // 3. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, "Agent")).        // 4. Check duplicate
		AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).                    // 5. Set defaults
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent")).               // 6. Persist agent
		AddStep(agentsteps.NewCreateDefaultInstanceStep()).                            // 8. Create default instance (TODO)
		AddStep(agentsteps.NewUpdateAgentStatusWithDefaultInstanceStep(c.store)).      // 9. Update status (TODO)
		// TODO: Add CreateIamPolicies step when IAM system is ready
		// TODO: Add Publish step when event system is ready
		Build()
}
