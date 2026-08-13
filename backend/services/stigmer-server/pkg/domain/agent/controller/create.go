package agent

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentinstance/defaultinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Context keys for inter-step communication
const (
	DefaultInstanceIDKey = "default_instance_id"
)

// Create creates a new agent using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. CheckDuplicate - Verify no duplicate exists
// 4. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event), default visibility
// 5. NormalizeReferences - Resolve empty org in cross-references (skill_refs, mcp_server_usages, etc.)
// 5b. ValidateReferences - Referenced resources must exist
// 5c. ValidateEnabledTools - enabled_tools must name discovered tools (skips unconnected servers)
// 6. MergeMcpServerEnvSpecs - Merge env_spec entries from referenced MCP servers into agent
// 7. Persist - Save agent to repository
// 8. CreateDefaultInstance - Create default agent instance
// 9. UpdateAgentStatusWithDefaultInstance - Update agent status with default_instance_id
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
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
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*agentv1.Agent]("agent-create").
		AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).                                   // 1. Validate field constraints
		AddStep(steps.NewValidateVisibilityStep[*agentv1.Agent]()).                              // Reject unsupported visibility levels (fail fast)
		AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).                                     // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store)).                           // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*agentv1.Agent]()).                                   // 4. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*agentv1.Agent]()).                             // 5. Normalize cross-references
		AddStep(steps.NewValidateReferencesStep[*agentv1.Agent](c.store)).                       // 5b. Validate referenced resources exist
		AddStep(newValidateEnabledToolsStep(c.store)).                                           // 5c. Validate enabled_tools against discovered capabilities
		AddStep(newMergeMcpServerEnvSpecsStep(c.store)).                                         // 6. Merge MCP server env_specs
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).                                  // 7. Persist agent
		AddStep(newCreateDefaultInstanceStep(c.agentInstanceClient)).                            // 6. Create default instance
		AddStep(newUpdateAgentStatusWithDefaultInstanceStep(c.store)).                           // 7. Update status
		AddStep(steps.NewIndexSearchStep[*agentv1.Agent](c.store, &extractor.AgentExtractor{})). // 8. Update search index
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java AgentCreateHandler pattern)
// ============================================================================

// createDefaultInstanceStep creates a default agent instance for the newly created agent.
//
// This step:
// 1. Builds AgentInstance request with no environment_refs
// 2. Calls AgentInstanceController via in-process client (similar to Java's AgentInstanceGrpcRepo)
// 3. Stores returned default_instance_id in context for next step
//
// Architecture note: Uses downstream client to maintain domain separation.
// The agent instance creation handler handles all persistence and validation.
// This step does NOT update agent status - that's done in updateAgentStatusWithDefaultInstanceStep.
type createDefaultInstanceStep struct {
	agentInstanceClient *agentinstance.Client
}

func newCreateDefaultInstanceStep(agentInstanceClient *agentinstance.Client) *createDefaultInstanceStep {
	return &createDefaultInstanceStep{agentInstanceClient: agentInstanceClient}
}

func (s *createDefaultInstanceStep) Name() string {
	return "CreateDefaultInstance"
}

func (s *createDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	if s.agentInstanceClient == nil {
		log.Debug().Msg("Skipping CreateDefaultInstance: agentInstanceClient is nil")
		return nil
	}

	agent := ctx.NewState()
	agentID := agent.GetMetadata().GetId()

	log.Info().
		Str("agent_id", agentID).
		Str("slug", agent.GetMetadata().GetSlug()).
		Str("org", agent.GetMetadata().GetOrg()).
		Msg("Creating default instance for agent")

	instanceRequest := defaultinstance.BuildRequest(agent.GetMetadata())

	// Use Apply (not Create) for idempotency. Agent delete now cascades the
	// default instance, so this normally routes to CREATE; the UPDATE route
	// remains as self-heal for pre-cascade legacy orphans (self-hosters
	// upgrading across the T08 release) — Apply recovers such an orphan by
	// re-pointing its agent_id at the new agent.
	applied, err := s.agentInstanceClient.ApplyAsSystem(ctx.Context(), instanceRequest)
	if err != nil {
		return fmt.Errorf("failed to apply default instance: %w", err)
	}

	log.Info().
		Str("instance_id", applied.GetMetadata().GetId()).
		Str("agent_id", agentID).
		Msg("Successfully applied default instance for agent")

	ctx.Set(DefaultInstanceIDKey, applied.GetMetadata().GetId())

	return nil
}

// updateAgentStatusWithDefaultInstanceStep updates agent status with default instance ID.
//
// This step:
// 1. Reads default_instance_id from context (set by createDefaultInstanceStep)
// 2. Updates agent status with default_instance_id
// 3. Persists updated agent to repository
// 4. Updates context with persisted agent for response
//
// Separated from createDefaultInstanceStep for pipeline clarity - makes it explicit
// that a database persist operation is happening.
type updateAgentStatusWithDefaultInstanceStep struct {
	store store.Store
}

func newUpdateAgentStatusWithDefaultInstanceStep(store store.Store) *updateAgentStatusWithDefaultInstanceStep {
	return &updateAgentStatusWithDefaultInstanceStep{store: store}
}

func (s *updateAgentStatusWithDefaultInstanceStep) Name() string {
	return "UpdateAgentStatusWithDefaultInstance"
}

func (s *updateAgentStatusWithDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
	agent := ctx.NewState()
	agentID := agent.GetMetadata().GetId()

	// 1. Read default instance ID from context
	defaultInstanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
	if !ok || defaultInstanceID == "" {
		// Skip if no default instance was created (e.g., in test mode with nil client)
		log.Debug().
			Str("agent_id", agentID).
			Msg("Skipping UpdateAgentStatusWithDefaultInstance: no default instance ID in context (likely in test mode)")
		return nil
	}

	log.Info().
		Str("default_instance_id", defaultInstanceID).
		Str("agent_id", agentID).
		Msg("Updating agent status with default_instance_id")

	// 2. Update agent status with default_instance_id
	if agent.Status == nil {
		agent.Status = &agentv1.AgentStatus{}
	}
	agent.Status.DefaultInstanceId = defaultInstanceID

	// 3. Persist updated agent to repository
	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	if err := s.store.SaveResource(ctx.Context(), kind, agentID, agent); err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentID).
			Msg("Failed to persist agent with default_instance_id")
		return fmt.Errorf("failed to persist agent with default instance: %w", err)
	}
	log.Debug().Str("agent_id", agentID).Msg("Persisted agent with default_instance_id")

	// 4. Update context with persisted agent for response
	ctx.SetNewState(agent)

	log.Info().
		Str("default_instance_id", defaultInstanceID).
		Str("agent_id", agentID).
		Msg("Successfully updated agent status with default_instance_id")

	return nil
}
