package agent

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource/apiresourcekind"
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
	// Use the ApiResourceKind enum for agent
	kind := apiresourcekind.ApiResourceKind_agent

	return pipeline.NewPipeline[*agentv1.Agent]("agent-create").
		AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).               // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).                 // 3. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, kind)). // 4. Check duplicate
		AddStep(steps.NewSetDefaultsStep[*agentv1.Agent](kind)).             // 5. Set defaults
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, kind)).        // 6. Persist agent
		AddStep(c.newCreateDefaultInstanceStep()).                           // 8. Create default instance (TODO)
		AddStep(c.newUpdateAgentStatusWithDefaultInstanceStep()).            // 9. Update status (TODO)
		// TODO: Add CreateIamPolicies step when IAM system is ready
		// TODO: Add Publish step when event system is ready
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java AgentCreateHandler pattern)
// ============================================================================

// createDefaultInstanceStep creates a default agent instance for the newly created agent.
//
// This step (when implemented) will:
// 1. Build AgentInstance request with no environment_refs
// 2. Call AgentInstanceController via in-process gRPC (similar to Java's AgentInstanceGrpcRepo)
// 3. Store returned default_instance_id in context for next step
//
// Architecture note: Uses downstream controller to maintain domain separation.
// The agent instance creation handler handles all persistence and validation.
// This step does NOT update agent status - that's done in updateAgentStatusWithDefaultInstanceStep.
//
// Status: TODO - Requires AgentInstance controller and gRPC client implementation
type createDefaultInstanceStep struct {
	// agentInstanceClient AgentInstanceCommandControllerClient // TODO: Add when gRPC client ready
}

func (c *AgentController) newCreateDefaultInstanceStep() *createDefaultInstanceStep {
	return &createDefaultInstanceStep{
		// agentInstanceClient: c.agentInstanceClient, // TODO: inject from controller
	}
}

func (s *createDefaultInstanceStep) Name() string {
	return "CreateDefaultInstance"
}

func (s *createDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	// TODO: Implement when AgentInstance controller and gRPC client are ready
	//
	// Following the Java pattern from AgentCreateHandler.CreateDefaultInstance:
	//
	// agent := ctx.NewState()
	// agentID := agent.Metadata.Id
	// agentSlug := agent.Metadata.Name
	// ownerScope := agent.Metadata.OwnerScope
	//
	// log.Info("Creating default instance for agent: %s (slug: %s, scope: %s)",
	//     agentID, agentSlug, ownerScope)
	//
	// // 1. Build default instance request
	// defaultInstanceName := agentSlug + "-default"
	//
	// metadataBuilder := &apiresource.ApiResourceMetadata{
	//     Name: defaultInstanceName,
	//     OwnerScope: ownerScope,
	// }
	//
	// // Copy org if org-scoped
	// if ownerScope == apiresource.ApiResourceOwnerScope_organization {
	//     metadataBuilder.Org = agent.Metadata.Org
	// }
	//
	// instanceRequest := &agentinstancev1.AgentInstance{
	//     ApiVersion: "agentic.stigmer.ai/v1",
	//     Kind: "AgentInstance",
	//     Metadata: metadataBuilder,
	//     Spec: &agentinstancev1.AgentInstanceSpec{
	//         AgentId: agentID,
	//         Description: "Default instance (auto-created, no custom configuration)",
	//     },
	// }
	//
	// // 2. Create instance via downstream gRPC (in-process, system credentials)
	// // This calls AgentInstanceCommandController.Create() in-process
	// // All persistence, IAM policies, and validation handled by instance handler
	// createdInstance, err := s.agentInstanceClient.Create(ctx.Context(), instanceRequest)
	// if err != nil {
	//     return fmt.Errorf("failed to create default instance: %w", err)
	// }
	//
	// defaultInstanceID := createdInstance.Metadata.Id
	// log.Info("Successfully created default instance: %s for agent: %s",
	//     defaultInstanceID, agentID)
	//
	// // 3. Store instance ID in context for next step
	// ctx.Set(DefaultInstanceIDKey, defaultInstanceID)

	return nil // Skip for now
}

// updateAgentStatusWithDefaultInstanceStep updates agent status with default instance ID.
//
// This step (when implemented) will:
// 1. Read default_instance_id from context (set by createDefaultInstanceStep)
// 2. Update agent status with default_instance_id
// 3. Persist updated agent to repository
// 4. Update context with persisted agent for response
//
// Separated from createDefaultInstanceStep for pipeline clarity - makes it explicit
// that a database persist operation is happening.
//
// Status: TODO - Requires AgentInstance controller implementation
type updateAgentStatusWithDefaultInstanceStep struct {
	controller *AgentController
}

func (c *AgentController) newUpdateAgentStatusWithDefaultInstanceStep() *updateAgentStatusWithDefaultInstanceStep {
	return &updateAgentStatusWithDefaultInstanceStep{controller: c}
}

func (s *updateAgentStatusWithDefaultInstanceStep) Name() string {
	return "UpdateAgentStatusWithDefaultInstance"
}

func (s *updateAgentStatusWithDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	// TODO: Implement when AgentInstance is ready
	//
	// Following the Java pattern from AgentCreateHandler.UpdateAgentStatusWithDefaultInstance:
	//
	// agent := ctx.NewState()
	// agentID := agent.Metadata.Id
	//
	// // 1. Read default instance ID from context
	// defaultInstanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
	// if !ok || defaultInstanceID == "" {
	//     log.Error("DEFAULT_INSTANCE_ID not found in context for agent: %s", agentID)
	//     return fmt.Errorf("default instance ID not found in context")
	// }
	//
	// log.Info("Updating agent status with default_instance_id: %s for agent: %s",
	//     defaultInstanceID, agentID)
	//
	// // 2. Update agent status with default_instance_id
	// if agent.Status == nil {
	//     agent.Status = &agentv1.AgentStatus{}
	// }
	// agent.Status.DefaultInstanceId = defaultInstanceID
	//
	// // 3. Persist updated agent to repository
	// if err := s.controller.store.SaveResource(ctx.Context(), "Agent", agentID, agent); err != nil {
	//     log.Error("Failed to persist agent with default_instance_id for agent: %s: %v",
	//         agentID, err)
	//     return fmt.Errorf("failed to persist agent with default instance: %w", err)
	// }
	// log.Debug("Persisted agent with default_instance_id: %s", agentID)
	//
	// // 4. Update context with persisted agent for response
	// ctx.SetNewState(agent)
	//
	// log.Info("Successfully updated agent status with default_instance_id: %s for agent: %s",
	//     defaultInstanceID, agentID)

	return nil // Skip for now
}
