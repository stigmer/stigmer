package session

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
	"google.golang.org/grpc/codes"
)

// Create creates a new session using the pipeline framework
//
// Pipeline (Stigmer OSS):
//  1. ResolveDefaultAgentInstance - If agent_instance_id is empty, resolve platform default agent + instance
//  2. ValidateFieldConstraints - Validate proto field constraints using buf validate
//  3. ResolveSlug - Generate slug from metadata.name
//  4. CheckDuplicate - Verify no duplicate exists
//  5. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
//  6. NormalizeReferences - Resolve cross-references (slugs to IDs)
//  7. Persist - Save session to repository
//  8. IndexSearch - Update search index
func (c *SessionController) Create(ctx context.Context, session *sessionv1.Session) (*sessionv1.Session, error) {
	reqCtx := pipeline.NewRequestContext(ctx, session)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for session creation
func (c *SessionController) buildCreatePipeline() *pipeline.Pipeline[*sessionv1.Session] {
	return pipeline.NewPipeline[*sessionv1.Session]("session-create").
		AddStep(newResolveDefaultAgentInstanceStep(c.store, c.agentClient, c.agentInstanceClient)).    // 1. Resolve default agent instance if needed
		AddStep(steps.NewValidateProtoStep[*sessionv1.Session]()).                                     // 2. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*sessionv1.Session]()).                                       // 3. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*sessionv1.Session](c.store)).                             // 4. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*sessionv1.Session]()).                                     // 5. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*sessionv1.Session]()).                               // 6. Normalize cross-references
		AddStep(steps.NewPersistStep[*sessionv1.Session](c.store)).                                    // 7. Persist session
		AddStep(steps.NewIndexSearchStep[*sessionv1.Session](c.store, &extractor.SessionExtractor{})). // 8. Update search index
		Build()
}

// resolveDefaultAgentInstanceStep resolves the platform default agent and ensures
// a default instance exists when agent_instance_id is not provided on the session.
//
// This enables the session-first UX where users create a session (with workspace
// entries) without knowing the agent instance — the backend resolves it automatically.
//
// The resolution reuses the same pattern established in T01.2 for agent execution
// creation: find agent by label stigmer.ai/default-agent=true, get or create its
// default instance, and set agent_instance_id on the session spec.
//
// If agent_instance_id is already provided, this step is a no-op.
type resolveDefaultAgentInstanceStep struct {
	store               store.Store
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
}

func newResolveDefaultAgentInstanceStep(
	store store.Store,
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
) *resolveDefaultAgentInstanceStep {
	return &resolveDefaultAgentInstanceStep{
		store:               store,
		agentClient:         agentClient,
		agentInstanceClient: agentInstanceClient,
	}
}

func (s *resolveDefaultAgentInstanceStep) Name() string {
	return "ResolveDefaultAgentInstance"
}

func (s *resolveDefaultAgentInstanceStep) Execute(ctx *pipeline.RequestContext[*sessionv1.Session]) error {
	sess := ctx.Input()

	if sess.GetSpec().GetAgentInstanceId() != "" {
		return nil
	}

	log.Info().Msg("agent_instance_id not provided on session, resolving platform default agent")

	// 1. Find default agent by label
	defaultAgent := &agentv1.Agent{}
	err := s.store.FindByLabel(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_agent,
		"stigmer.ai/default-agent", "true",
		defaultAgent,
	)
	if err != nil {
		log.Error().Err(err).Msg("Failed to find platform default agent")
		return grpclib.WrapError(
			fmt.Errorf("no default agent available on this platform: %w", err),
			codes.NotFound,
			"No default agent available. Ensure an agent with label stigmer.ai/default-agent=true and visibility_public exists",
		)
	}

	if defaultAgent.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
		return grpclib.WrapError(
			fmt.Errorf("default agent is not publicly accessible"),
			codes.FailedPrecondition,
			"Default agent exists but is not visibility_public",
		)
	}

	agentID := defaultAgent.GetMetadata().GetId()
	log.Info().
		Str("agent_id", agentID).
		Str("agent_name", defaultAgent.GetMetadata().GetName()).
		Msg("Resolved platform default agent")

	// 2. Get or create default instance
	defaultInstanceID := defaultAgent.GetStatus().GetDefaultInstanceId()

	if defaultInstanceID == "" {
		log.Info().Str("agent_id", agentID).Msg("Default instance missing, creating one")

		agentSlug := defaultAgent.GetMetadata().GetName()
		agentOrg := defaultAgent.GetMetadata().GetOrg()

		instanceRequest := &agentinstancev1.AgentInstance{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: agentSlug + "-default",
				Org:  agentOrg,
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:     agentID,
				Description: "Default instance (auto-created, no custom configuration)",
			},
		}

		createdInstance, createErr := s.agentInstanceClient.CreateAsSystem(ctx.Context(), instanceRequest)
		if createErr != nil {
			log.Error().Err(createErr).Str("agent_id", agentID).Msg("Failed to create default instance")
			return fmt.Errorf("failed to create default instance for default agent: %w", createErr)
		}

		defaultInstanceID = createdInstance.GetMetadata().GetId()

		// Persist default_instance_id on the agent
		if defaultAgent.Status == nil {
			defaultAgent.Status = &agentv1.AgentStatus{}
		}
		defaultAgent.Status.DefaultInstanceId = defaultInstanceID
		if saveErr := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, agentID, defaultAgent); saveErr != nil {
			log.Error().Err(saveErr).Str("agent_id", agentID).Msg("Failed to persist agent with default_instance_id")
			return fmt.Errorf("failed to persist agent with default instance: %w", saveErr)
		}

		log.Info().
			Str("instance_id", defaultInstanceID).
			Str("agent_id", agentID).
			Msg("Created default instance for default agent")
	}

	// 3. Set agent_instance_id on the session's newState (not input).
	// The pipeline clones input into newState at construction; Persist saves newState.
	// Mutating input does NOT propagate to newState, so we must set it here.
	newState := ctx.NewState()
	if newState.Spec == nil {
		newState.Spec = &sessionv1.SessionSpec{}
	}
	newState.Spec.AgentInstanceId = defaultInstanceID

	log.Info().
		Str("agent_instance_id", defaultInstanceID).
		Msg("Set agent_instance_id on session from platform default agent")

	return nil
}
