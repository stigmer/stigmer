package controllers

import (
	"context"
	"fmt"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// Context keys for inter-step communication
const (
	DefaultInstanceIDKey = "default_instance_id"
)

// AgentController implements AgentCommandController and AgentQueryController
type AgentController struct {
	agentv1.UnimplementedAgentCommandControllerServer
	agentv1.UnimplementedAgentQueryControllerServer
	store *badger.Store
}

// NewAgentController creates a new AgentController
func NewAgentController(store *badger.Store) *AgentController {
	return &AgentController{store: store}
}

// Create creates a new agent using the pipeline framework
//
// Pipeline (aligned with Stigmer Cloud AgentCreateHandler):
// 1. ValidateFieldConstraints - Validate proto field constraints (TODO: when validation framework ready)
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

	p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
		AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).          // 3. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, "Agent")). // 4. Check duplicate
		AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).   // 5. Set defaults
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent")). // 6. Persist agent
		// TODO: Add CreateIamPolicies step when IAM system is ready
		// TODO: Add CreateDefaultInstance step when AgentInstance controller is ready
		// TODO: Add UpdateAgentStatusWithDefaultInstance step when AgentInstance is ready
		// TODO: Add Publish step when event system is ready
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// ============================================================================
// Custom Pipeline Steps (To be implemented when dependencies are ready)
// ============================================================================

// CreateDefaultInstanceStep creates a default agent instance for the newly created agent.
//
// This step (when implemented) will:
// 1. Build AgentInstance request with no environment_refs
// 2. Call AgentInstanceController.Create() (in-process gRPC or direct call)
// 3. Store returned default_instance_id in context for next step
//
// Architecture note: Uses downstream controller to maintain domain separation.
// The agent instance creation handler handles all persistence and validation.
// This step does NOT update agent status - that's done in UpdateAgentStatusWithDefaultInstance.
//
// Status: TODO - Requires AgentInstance controller implementation
type CreateDefaultInstanceStep struct {
	// agentInstanceController *AgentInstanceController // TODO: Add when ready
}

func NewCreateDefaultInstanceStep() *CreateDefaultInstanceStep {
	return &CreateDefaultInstanceStep{}
}

func (s *CreateDefaultInstanceStep) Name() string {
	return "CreateDefaultInstance"
}

func (s *CreateDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	// TODO: Implement when AgentInstance controller is ready
	//
	// agent := ctx.NewState()
	// agentID := agent.Metadata.Id
	// agentSlug := agent.Metadata.Name
	//
	// // Build default instance request
	// instanceName := agentSlug + "-default"
	// instanceRequest := &agentinstancev1.AgentInstance{
	//     Metadata: &apiresource.ApiResourceMetadata{
	//         Name: instanceName,
	//         OwnerScope: agent.Metadata.OwnerScope,
	//         Org: agent.Metadata.Org, // if org-scoped
	//     },
	//     Spec: &agentinstancev1.AgentInstanceSpec{
	//         AgentId: agentID,
	//         Description: "Default instance (auto-created, no custom configuration)",
	//     },
	// }
	//
	// // Create instance via controller (or gRPC)
	// createdInstance, err := s.agentInstanceController.Create(ctx.Context(), instanceRequest)
	// if err != nil {
	//     return fmt.Errorf("failed to create default instance: %w", err)
	// }
	//
	// // Store instance ID in context for next step
	// ctx.Set(DefaultInstanceIDKey, createdInstance.Metadata.Id)
	
	return nil // Skip for now
}

// UpdateAgentStatusWithDefaultInstanceStep updates agent status with default instance ID.
//
// This step (when implemented) will:
// 1. Read default_instance_id from context (set by CreateDefaultInstance)
// 2. Update agent status with default_instance_id
// 3. Persist updated agent to repository
// 4. Update context with persisted agent for response
//
// Separated from CreateDefaultInstance for pipeline clarity - makes it explicit
// that a database persist operation is happening.
//
// Status: TODO - Requires AgentInstance controller implementation
type UpdateAgentStatusWithDefaultInstanceStep struct {
	store *badger.Store
}

func NewUpdateAgentStatusWithDefaultInstanceStep(store *badger.Store) *UpdateAgentStatusWithDefaultInstanceStep {
	return &UpdateAgentStatusWithDefaultInstanceStep{store: store}
}

func (s *UpdateAgentStatusWithDefaultInstanceStep) Name() string {
	return "UpdateAgentStatusWithDefaultInstance"
}

func (s *UpdateAgentStatusWithDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	// TODO: Implement when AgentInstance is ready
	//
	// agent := ctx.NewState()
	// agentID := agent.Metadata.Id
	//
	// // Read default instance ID from context
	// defaultInstanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
	// if !ok || defaultInstanceID == "" {
	//     return fmt.Errorf("default instance ID not found in context")
	// }
	//
	// // Update agent status
	// if agent.Status == nil {
	//     agent.Status = &agentv1.AgentStatus{}
	// }
	// agent.Status.DefaultInstanceId = defaultInstanceID
	//
	// // Persist updated agent
	// if err := s.store.SaveResource(ctx.Context(), "Agent", agentID, agent); err != nil {
	//     return fmt.Errorf("failed to persist agent with default instance: %w", err)
	// }
	//
	// // Update context with persisted agent for response
	// ctx.SetNewState(agent)
	
	return nil // Skip for now
}

// PublishEventStep publishes an event for the agent creation/update.
//
// This step (when implemented) will:
// 1. Build event message with agent data
// 2. Publish to event broker/stream
//
// Status: TODO - Requires event system implementation
type PublishEventStep struct{}

func NewPublishEventStep() *PublishEventStep {
	return &PublishEventStep{}
}

func (s *PublishEventStep) Name() string {
	return "PublishEvent"
}

func (s *PublishEventStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	// TODO: Implement when event system is ready
	// agent := ctx.NewState()
	// eventPublisher.Publish("agent.created", agent)
	return nil // Skip for now
}

// ============================================================================
// CRUD Handlers
// ============================================================================

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

// Delete deletes an agent
func (c *AgentController) Delete(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	if agentId == nil || agentId.Value == "" {
		return nil, grpclib.InvalidArgumentError("agent id is required")
	}

	// Get agent before deletion (to return it)
	agent := &agentv1.Agent{}
	if err := c.store.GetResource(ctx, agentId.Value, agent); err != nil {
		return nil, grpclib.NotFoundError("Agent", agentId.Value)
	}

	// Delete agent
	if err := c.store.DeleteResource(ctx, agentId.Value); err != nil {
		return nil, grpclib.InternalError(err, "failed to delete agent")
	}

	return agent, nil
}

// Get retrieves an agent by ID
func (c *AgentController) Get(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	if agentId == nil || agentId.Value == "" {
		return nil, grpclib.InvalidArgumentError("agent id is required")
	}

	agent := &agentv1.Agent{}
	if err := c.store.GetResource(ctx, agentId.Value, agent); err != nil {
		return nil, grpclib.NotFoundError("Agent", agentId.Value)
	}

	return agent, nil
}

// GetByReference retrieves an agent by reference (slug)
func (c *AgentController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*agentv1.Agent, error) {
	if ref == nil {
		return nil, grpclib.InvalidArgumentError("reference is required")
	}

	// Try to get by slug
	if ref.Slug != "" {
		return c.findByName(ctx, ref.Slug, ref.Org)
	}

	return nil, grpclib.InvalidArgumentError("slug is required")
}

// findByName finds an agent by name (helper function)
func (c *AgentController) findByName(ctx context.Context, name string, orgID string) (*agentv1.Agent, error) {
	// List all agents and filter by name
	// Note: This is not efficient for large datasets, but acceptable for local usage
	var resources [][]byte
	var err error

	if orgID != "" {
		resources, err = c.store.ListResourcesByOrg(ctx, "Agent", orgID)
	} else {
		resources, err = c.store.ListResources(ctx, "Agent")
	}

	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agents")
	}

	for _, data := range resources {
		agent := &agentv1.Agent{}
		// BadgerDB returns proto bytes (not JSON), so use proto.Unmarshal
		if err := proto.Unmarshal(data, agent); err != nil {
			continue
		}

		if agent.Metadata.Name == name {
			// Check org filter if provided
			if orgID != "" && agent.Metadata.Org != orgID {
				continue
			}
			return agent, nil
		}
	}

	return nil, grpclib.WrapError(nil, codes.NotFound, fmt.Sprintf("agent not found with name: %s", name))
}
