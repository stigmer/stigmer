package agentinstance

import (
	"context"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Create creates a new agent instance using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ValidateVisibility - Reject unsupported visibility levels
// 3. ResolveSlug - Generate slug from metadata.name
// 4. LoadParentAgent - Load and validate the agent template exists
// 5. CheckDuplicate - Verify no duplicate exists
// 6. BuildNewState - Generate ID, clear status, set audit fields, default visibility
// 7. NormalizeReferences - Normalize cross-references
// 8. Persist - Save agent instance to repository
// 9. IndexSearch - Update search index
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (FGA can_create_instance on the parent agent — no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
//
// Deliberately NO same-org rule here, unlike WorkflowInstance's create: an
// agent is a shareable blueprint, and one agent legitimately has instances
// in several orgs (an org publishes an agent, a consumer org instantiates
// it — the marketplace case). Cloud governs cross-org creation with FGA
// authorization on the parent agent, not an org-equality check; OSS has no
// authorization layer, so cross-org creation is allowed.
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
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*agentinstancev1.AgentInstance]("agent-instance-create").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.AgentInstance]()).                                           // 1. Validate field constraints
		AddStep(steps.NewValidateVisibilityStep[*agentinstancev1.AgentInstance]()).                                      // 2. Reject unsupported visibility levels (fail fast)
		AddStep(steps.NewResolveSlugStep[*agentinstancev1.AgentInstance]()).                                             // 3. Resolve slug
		AddStep(newLoadParentAgentStep(c.agentClient)).                                                                  // 4. Load parent agent
		AddStep(steps.NewCheckDuplicateStep[*agentinstancev1.AgentInstance](c.store)).                                   // 5. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*agentinstancev1.AgentInstance]()).                                           // 6. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*agentinstancev1.AgentInstance]()).                                     // 7. Normalize cross-references
		AddStep(steps.NewPersistStep[*agentinstancev1.AgentInstance](c.store)).                                          // 8. Persist agent instance
		AddStep(steps.NewIndexSearchStep[*agentinstancev1.AgentInstance](c.store, &extractor.AgentInstanceExtractor{})). // 9. Update search index
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java AgentInstanceCreateHandler pattern)
// ============================================================================

// loadParentAgentStep loads the parent agent to validate it exists.
//
// An unknown spec.agent_id is rejected with NotFound instead of persisting a
// dangling instance (oss#645) — converging on cloud's LoadParentAgent step
// and on this server's own WorkflowInstance create pipeline.
//
// Unlike its WorkflowInstance twin, the loaded agent is NOT stored in the
// request context: nothing downstream consumes it (cloud's consumer is the
// FGA authorize step, which OSS excludes; the WorkflowInstance twin's
// consumer is the same-org rule, which agent instances deliberately do not
// have — see the Create doc comment).
type loadParentAgentStep struct {
	agentClient *agent.Client
}

func newLoadParentAgentStep(agentClient *agent.Client) *loadParentAgentStep {
	return &loadParentAgentStep{agentClient: agentClient}
}

func (s *loadParentAgentStep) Name() string {
	return "LoadParentAgent"
}

func (s *loadParentAgentStep) Execute(ctx *pipeline.RequestContext[*agentinstancev1.AgentInstance]) error {
	requestedInstance := ctx.Input()
	agentID := requestedInstance.GetSpec().GetAgentId()

	log.Info().
		Str("agent_id", agentID).
		Msg("Loading parent agent")

	// Load agent via downstream client
	parentAgent, err := s.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
	if err != nil {
		log.Warn().
			Err(err).
			Str("agent_id", agentID).
			Msg("Parent agent not found")
		return grpclib.NotFoundError("Agent", agentID)
	}

	log.Debug().
		Str("agent_id", agentID).
		Str("org", parentAgent.GetMetadata().GetOrg()).
		Msg("Loaded parent agent")

	return nil
}
