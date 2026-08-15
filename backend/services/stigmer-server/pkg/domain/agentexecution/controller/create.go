package agentexecution

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/defaultagent"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentinstance/defaultinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// Context keys for inter-step communication
const (
	DefaultInstanceIDKey = "default_instance_id"
	CreatedSessionIDKey  = "created_session_id"
)

// autoCreatedSessionSubject is the sentinel subject written on auto-created
// sessions. The GenerateSessionSubject activity replaces it with an
// LLM-generated title; display paths filter it (see PENDING_SUBJECT in
// sdk/typescript/src/session.ts and ResolvedSubject in the Go CLI).
const autoCreatedSessionSubject = "Auto-created session"

// Create creates a new agent execution using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
//  1. ValidateFieldConstraints - Validate proto field constraints using buf validate
//     1b. ValidateServiceTier - Fail closed: service_tier vs the model registry (#357)
//  2. ResolveDefaultAgent - If no session_id or agent_id, resolve platform default agent
//  3. EnsureSessionOrAgentResolved - Post-condition guard: a session or agent
//     reference must be resolved by this point (see step doc for why this is an
//     invariant, not input validation)
//  4. ResolveSlug - Generate slug from metadata.name
//  5. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event), default visibility
//  6. NormalizeReferences - Resolve cross-references (slugs to IDs)
//  7. EnsureEngineAvailable - Fail fast with Unavailable if the agent execution engine is not connected (before the first side effect)
//  8. CreateDefaultInstanceIfNeeded - Create default agent instance if missing
//  9. CreateSessionIfNeeded - Create session if session_id not provided (uses caller's org)
//  10. ComposeDeclaredPreferences - Snapshot org standing context onto the spec
//     (server-owned field, best-effort — see the step doc for the contract)
//  11. SetInitialPhase - Set execution phase to PENDING
//  12. CreateExecutionContext - Merge environment into execution context
//  13. ProcessAttachments - Validate pre-uploaded attachments
//  14. Persist - Save execution to repository
//  15. IndexSearch - Update search index
//  16. StartWorkflow - Start Temporal workflow
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - PublishToRedis step (no Redis in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *AgentExecutionController) Create(ctx context.Context, execution *agentexecutionv1.AgentExecution) (*agentexecutionv1.AgentExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, execution)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for agent execution creation
func (c *AgentExecutionController) buildCreatePipeline() *pipeline.Pipeline[*agentexecutionv1.AgentExecution] {
	return pipeline.NewPipeline[*agentexecutionv1.AgentExecution]("agent-execution-create").
		AddStep(steps.NewValidateProtoStep[*agentexecutionv1.AgentExecution]()).                                            // 1. Validate field constraints
		AddStep(steps.NewValidateVisibilityStep[*agentexecutionv1.AgentExecution]()).                                       // Reject unsupported visibility levels (fail fast)
		AddStep(newValidateServiceTierStep()).                                                                              // 1b. Fail closed: service_tier validated against the registry before any side effect (#357)
		AddStep(newValidateThinkingModeStep()).                                                                             // 1c. Fail closed: thinking_mode validated against the registry capability (#772)
		AddStep(newResolveDefaultAgentStep(c.store)).                                                                       // 2. Resolve platform default agent if needed
		AddStep(newEnsureSessionOrAgentResolvedStep()).                                                                     // 3. Guard: session or agent reference resolved
		AddStep(steps.NewResolveSlugStep[*agentexecutionv1.AgentExecution]()).                                              // 4. Resolve slug
		AddStep(steps.NewBuildNewStateStep[*agentexecutionv1.AgentExecution]()).                                            // 5. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*agentexecutionv1.AgentExecution]()).                                      // 6. Normalize cross-references
		AddStep(c.newEnsureEngineAvailableStep()).                                                                          // 7. Fail fast if the agent execution engine is unavailable (before the first side effect)
		AddStep(newCreateDefaultInstanceIfNeededStep(c.agentClient, c.agentInstanceClient, c.store)).                       // 8. Create default instance if needed
		AddStep(newCreateSessionIfNeededStep(c.sessionClient)).                                                             // 9. Create session if needed
		AddStep(newComposeDeclaredPreferencesStep(c.store)).                                                                // 10. Snapshot org standing context (server-owned field, best-effort)
		AddStep(newSetInitialPhaseStep()).                                                                                  // 11. Set phase to PENDING
		AddStep(c.newCreateExecutionContextStep()).                                                                         // 12. Create ExecutionContext with merged environment
		AddStep(c.newProcessAttachmentsStep()).                                                                             // 13. Process attachments
		AddStep(steps.NewPersistStep[*agentexecutionv1.AgentExecution](c.store)).                                           // 14. Persist execution
		AddStep(steps.NewIndexSearchStep[*agentexecutionv1.AgentExecution](c.store, &extractor.AgentExecutionExtractor{})). // 15. Update search index
		AddStep(c.newStartWorkflowStep()).                                                                                  // 16. Start Temporal workflow
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java AgentExecutionCreateHandler pattern)
// ============================================================================

// resolveDefaultAgentStep resolves the platform's public default agent when
// neither session_id nor agent_id is provided on the execution request.
//
// Contract: "neither session_id nor agent_id" is a VALID request shape — it is
// the session-first UX where a user starts a conversation without choosing an
// agent (see AgentExecutionSpec proto docs for the three-tier resolution). It is
// not an input error. When the platform has a default agent, this step resolves
// it; when it does not, the request cannot be served and this step returns
// NotFound (the same code the Agent.GetDefault RPC returns for this condition).
//
// The default agent is a platform-level concept: an agent in the stigmer org
// labeled stigmer.ai/default-agent: "true" with visibility_public. Resolution
// (candidate set, visibility preference, deterministic incumbent-wins
// tie-break) is owned by the defaultagent package, shared with the
// Agent.GetDefault RPC and session create.
//
// If session_id, agent_id, or session_spec.agent_instance_id is already
// provided, this step is a no-op. The session_spec case matters: a one-call
// bootstrap with an explicit instance needs no default-agent lookup, and
// resolving one anyway would stamp the default agent's ID onto
// execution.spec.agent_id — misleading metadata pointing at an agent the
// session does not run against.
type resolveDefaultAgentStep struct {
	store store.Store
}

func newResolveDefaultAgentStep(store store.Store) *resolveDefaultAgentStep {
	return &resolveDefaultAgentStep{store: store}
}

func (s *resolveDefaultAgentStep) Name() string {
	return "ResolveDefaultAgent"
}

func (s *resolveDefaultAgentStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.Input()
	sessionID := execution.GetSpec().GetSessionId()
	agentID := execution.GetSpec().GetAgentId()
	specInstanceID := execution.GetSpec().GetSessionSpec().GetAgentInstanceId()

	if sessionID != "" || agentID != "" || specInstanceID != "" {
		return nil
	}

	log.Info().Msg("Neither session_id nor agent_id provided, resolving platform default agent")

	defaultAgent, err := defaultagent.Find(ctx.Context(), s.store)
	switch {
	case errors.Is(err, defaultagent.ErrNotConfigured):
		log.Error().Err(err).Msg("No platform default agent configured")
		// Caller-actionable message: the create caller can fix this by supplying
		// a reference. This intentionally differs from the Agent.GetDefault RPC's
		// message (see agent/controller/get_default.go), whose caller is asking
		// specifically for the default agent and cannot supply session_id/agent_id.
		return grpclib.WrapError(
			fmt.Errorf("no default agent available on this platform: %w", err),
			codes.NotFound,
			"No default agent is configured on this platform. Provide session_id or agent_id explicitly, or seed an agent labeled stigmer.ai/default-agent=true with visibility_public",
		)
	case errors.Is(err, defaultagent.ErrNotPublic):
		log.Error().Err(err).Msg("Default agent is not visibility_public")
		return grpclib.WrapError(err,
			codes.FailedPrecondition,
			"Default agent exists but is not visibility_public",
		)
	case err != nil:
		// Store/decode failure — an internal fault, not "no default agent".
		// InternalError keeps the cause off the wire (stigmer/stigmer#478).
		log.Error().Err(err).Msg("Failed to resolve platform default agent")
		return grpclib.InternalError(err, "failed to resolve the platform default agent")
	}

	resolvedID := defaultAgent.GetMetadata().GetId()

	log.Info().
		Str("agent_id", resolvedID).
		Str("agent_name", defaultAgent.GetMetadata().GetName()).
		Msg("Resolved platform default agent")

	// Set agent_id on newState (not input). The pipeline clones input into
	// newState at construction; later steps and Persist operate on newState.
	newState := ctx.NewState()
	if newState.Spec == nil {
		newState.Spec = &agentexecutionv1.AgentExecutionSpec{}
	}
	newState.Spec.AgentId = resolvedID

	return nil
}

// ensureSessionOrAgentResolvedStep asserts the post-condition that a session,
// agent, or embedded-session-spec instance reference has been resolved by the
// time the pipeline reaches this point.
//
// This is an invariant guard, NOT input validation. "Neither session_id nor
// agent_id" is a valid request shape (session-first UX); ResolveDefaultAgent
// runs first and guarantees one of two outcomes: it resolves a reference onto
// newState, or it returns an error (NotFound / FailedPrecondition) that
// short-circuits the pipeline before this step runs. A one-call bootstrap
// (session_spec with an explicit agent_instance_id) is the third valid
// resolution — the session target is fully specified without either ID.
// Reaching this step with none of the three set is therefore a server-side
// programming error (e.g. a future step reordering that moves resolution after
// this guard), not bad client input — hence Internal, not InvalidArgument.
// This mirrors the invariant-guard idiom in the shared pipeline steps
// (steps/slug.go, steps/duplicate.go).
//
// Note the deliberate divergence from WorkflowExecution's validateWorkflowOrInstanceStep,
// which correctly returns InvalidArgument: WorkflowExecution has no "resolve
// default workflow" step, so workflow_id/workflow_instance_id is genuinely
// required and its check is reachable. Do not "harmonize" the two — the
// difference reflects a real semantic difference (issue #196).
type ensureSessionOrAgentResolvedStep struct{}

func newEnsureSessionOrAgentResolvedStep() *ensureSessionOrAgentResolvedStep {
	return &ensureSessionOrAgentResolvedStep{}
}

func (s *ensureSessionOrAgentResolvedStep) Name() string {
	return "EnsureSessionOrAgentResolved"
}

func (s *ensureSessionOrAgentResolvedStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	sessionID := execution.GetSpec().GetSessionId()
	agentID := execution.GetSpec().GetAgentId()
	specInstanceID := execution.GetSpec().GetSessionSpec().GetAgentInstanceId()

	hasSessionID := sessionID != ""
	hasAgentID := agentID != ""
	hasSpecInstanceID := specInstanceID != ""

	if !hasSessionID && !hasAgentID && !hasSpecInstanceID {
		log.Error().Msg("Invariant violated: no session, agent, or session_spec instance reference resolved after ResolveDefaultAgent")
		return grpclib.InternalError(
			fmt.Errorf("neither session_id, agent_id, nor session_spec.agent_instance_id set after ResolveDefaultAgent"),
			"execution target not resolved",
		)
	}

	log.Debug().
		Bool("has_session_id", hasSessionID).
		Bool("has_agent_id", hasAgentID).
		Bool("has_session_spec_instance_id", hasSpecInstanceID).
		Msg("Session or agent reference resolved")

	return nil
}

// createDefaultInstanceIfNeededStep creates default agent instance if agent doesn't have one
//
// This step:
//  1. Skips if session_id is provided (no need for agent operations), or if
//     session_spec carries an explicit agent_instance_id (the one-call
//     bootstrap already names the instance the session runs against)
//  2. Loads agent by agent_id
//  3. Checks if agent has default_instance_id in status
//  4. If missing, creates default instance (similar to AgentCreateHandler)
//  5. Updates agent status with default_instance_id
//  6. Stores default_instance_id in context for next step
type createDefaultInstanceIfNeededStep struct {
	agentClient         *agent.Client
	agentInstanceClient *agentinstance.Client
	store               store.Store
}

func newCreateDefaultInstanceIfNeededStep(
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
	store store.Store,
) *createDefaultInstanceIfNeededStep {
	return &createDefaultInstanceIfNeededStep{
		agentClient:         agentClient,
		agentInstanceClient: agentInstanceClient,
		store:               store,
	}
}

func (s *createDefaultInstanceIfNeededStep) Name() string {
	return "CreateDefaultInstanceIfNeeded"
}

func (s *createDefaultInstanceIfNeededStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	sessionID := execution.GetSpec().GetSessionId()
	agentID := execution.GetSpec().GetAgentId()

	// If session_id is provided, skip this step
	if sessionID != "" {
		log.Debug().
			Str("session_id", sessionID).
			Msg("Session ID already provided, skipping default instance check")
		return nil
	}

	// If the embedded session spec names an instance, the session target is
	// fully specified — no agent load or default-instance creation needed.
	if specInstanceID := execution.GetSpec().GetSessionSpec().GetAgentInstanceId(); specInstanceID != "" {
		log.Debug().
			Str("agent_instance_id", specInstanceID).
			Msg("session_spec carries an explicit agent instance, skipping default instance check")
		return nil
	}

	log.Debug().
		Str("agent_id", agentID).
		Msg("Checking if agent has default instance")

	// 1. Load agent by ID via in-process gRPC (single source of truth)
	agent, err := s.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentID).
			Msg("Agent not found")
		return err // Already a gRPC error from the client
	}

	defaultInstanceID := agent.GetStatus().GetDefaultInstanceId()

	// 2. Check if default instance exists
	if defaultInstanceID != "" {
		log.Debug().
			Str("default_instance_id", defaultInstanceID).
			Str("agent_id", agentID).
			Msg("Agent already has default instance")
		ctx.Set(DefaultInstanceIDKey, defaultInstanceID)
		return nil
	}

	// 3. Default instance missing - create it
	log.Info().
		Str("agent_id", agentID).
		Msg("Agent missing default instance, creating one")

	instanceRequest := defaultinstance.BuildRequest(agent.GetMetadata())

	// 4. Create instance via downstream client (in-process, system credentials)
	createdInstance, err := s.agentInstanceClient.CreateAsSystem(ctx.Context(), instanceRequest)
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentID).
			Msg("Failed to create default instance")
		return fmt.Errorf("failed to create default instance: %w", err)
	}

	log.Info().
		Str("instance_id", createdInstance.GetMetadata().GetId()).
		Str("agent_id", agentID).
		Msg("Successfully created default instance")

	createdInstanceID := createdInstance.GetMetadata().GetId()

	// 5. Update agent status with default_instance_id
	if agent.Status == nil {
		agent.Status = &agentv1.AgentStatus{}
	}
	agent.Status.DefaultInstanceId = createdInstanceID

	// Save agent directly to store (matching Java: agentRepo.save(updatedAgent))
	// Direct save avoids going through Update handler pipeline
	// Use AGENT kind explicitly since we're saving an agent, not the current resource
	agentKind := apiresourcekind.ApiResourceKind_agent
	if err := s.store.SaveResource(ctx.Context(), agentKind, agentID, agent); err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentID).
			Msg("Failed to persist agent with default_instance_id")
		return fmt.Errorf("failed to persist agent with default instance: %w", err)
	}

	log.Debug().
		Str("agent_id", agentID).
		Msg("Updated agent status with default_instance_id")

	// 6. Store instance ID in context for next step
	ctx.Set(DefaultInstanceIDKey, createdInstanceID)

	log.Info().
		Str("instance_id", createdInstanceID).
		Str("agent_id", agentID).
		Msg("Successfully ensured default instance exists")

	return nil
}

// createSessionIfNeededStep creates session if session_id is not provided
//
// This step:
//  1. Skips if session_id is provided
//  2. Builds the new session's spec: a caller-provided session_spec (one-call
//     bootstrap, stigmer/stigmer#249) is forwarded so the auto-created session
//     carries workspace_entries, harness, execution_target, etc.; otherwise
//     the session gets the minimal default spec
//  3. Fills agent_instance_id from context (set by previous step) when the
//     spec does not name one, and defaults the subject sentinel when empty
//  4. Uses the caller's org from execution metadata for session ownership
//  5. Creates the session and updates the execution request with its ID
//  6. Clears session_spec on the execution: the Session resource is the single
//     source of truth for session configuration, so the persisted execution
//     never carries a second copy that could drift
type createSessionIfNeededStep struct {
	sessionClient *session.Client
}

func newCreateSessionIfNeededStep(sessionClient *session.Client) *createSessionIfNeededStep {
	return &createSessionIfNeededStep{
		sessionClient: sessionClient,
	}
}

func (s *createSessionIfNeededStep) Name() string {
	return "CreateSessionIfNeeded"
}

func (s *createSessionIfNeededStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	sessionID := execution.GetSpec().GetSessionId()
	agentID := execution.GetSpec().GetAgentId()

	// If session_id is provided, skip session creation
	if sessionID != "" {
		log.Debug().
			Str("session_id", sessionID).
			Msg("Session ID already provided, skipping auto-creation")
		return nil
	}

	callerSpec := execution.GetSpec().GetSessionSpec()

	log.Info().
		Str("agent_id", agentID).
		Bool("has_session_spec", callerSpec != nil).
		Msg("Session ID not provided, auto-creating session")

	// 1. Resolve the agent instance when the caller's spec does not name one.
	// The previous step (CreateDefaultInstanceIfNeeded) resolved it and only
	// skips when the spec carries an explicit instance, so the context key is
	// present exactly when it is needed.
	defaultInstanceID := ""
	if callerSpec.GetAgentInstanceId() == "" {
		resolved, ok := ctx.Get(DefaultInstanceIDKey).(string)
		if !ok || resolved == "" {
			log.Error().
				Str("agent_id", agentID).
				Msg("DEFAULT_INSTANCE_ID not found in context")
			return fmt.Errorf("default instance ID not found in context")
		}
		defaultInstanceID = resolved

		log.Debug().
			Str("default_instance_id", defaultInstanceID).
			Msg("Using default instance from context for session creation")
	}

	// 2. Build the new session's spec from the caller's spec plus defaults.
	sessionSpec := buildAutoCreateSessionSpec(callerSpec, defaultInstanceID)

	// 3. Determine session org: use the caller's org from the execution metadata,
	// not the agent's org. This ensures sessions are owned by the caller even when
	// using a cross-org public agent (e.g., the platform default assistant).
	orgID := ctx.NewState().GetMetadata().GetOrg()
	if orgID == "" {
		orgID = ctx.Input().GetMetadata().GetOrg()
	}

	sessionRequest := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("session-%d", time.Now().UnixMilli()), // Auto-generated name
			Org:  orgID,                                             // All resources belong to an org
		},
		Spec: sessionSpec,
	}

	log.Debug().
		Str("agent_id", agentID).
		Str("instance_id", sessionSpec.GetAgentInstanceId()).
		Msg("Built session request")

	// 4. Create session via in-process gRPC (single source of truth)
	createdSession, err := s.sessionClient.Create(ctx.Context(), sessionRequest)
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentID).
			Msg("Failed to create session")
		return fmt.Errorf("failed to create session: %w", err)
	}

	sessionID = createdSession.GetMetadata().GetId()

	log.Info().
		Str("session_id", sessionID).
		Str("agent_id", agentID).
		Str("instance_id", sessionSpec.GetAgentInstanceId()).
		Msg("Successfully auto-created session")

	// 5. Update execution request with created session_id, and clear the
	// embedded spec: the Session resource created above is the single source
	// of truth for session configuration, so the persisted execution record
	// must not carry a second copy that could drift as the session evolves
	// (see AgentExecutionSpec.session_spec proto docs).
	if execution.Spec == nil {
		execution.Spec = &agentexecutionv1.AgentExecutionSpec{}
	}
	execution.Spec.SessionId = sessionID
	execution.Spec.SessionSpec = nil

	ctx.SetNewState(execution)

	// 6. Store session ID in context for tracking
	ctx.Set(CreatedSessionIDKey, sessionID)

	log.Debug().
		Str("session_id", sessionID).
		Msg("Updated execution request with session_id")

	return nil
}

// buildAutoCreateSessionSpec builds the spec for an auto-created session.
//
// A caller-provided spec (the one-call bootstrap, stigmer/stigmer#249) is
// cloned and forwarded so the session carries workspace_entries, harness,
// execution_target, MCP servers, and skills from a single create call; the
// clone keeps the execution request untouched while defaults are filled in.
// A nil callerSpec yields the minimal default spec (the pre-bootstrap
// auto-create behavior).
//
// defaultInstanceID is applied only when the caller's spec does not name an
// instance; an empty subject gets the sentinel so the GenerateSessionSubject
// activity titles bootstrapped sessions exactly as it does auto-created ones.
func buildAutoCreateSessionSpec(callerSpec *sessionv1.SessionSpec, defaultInstanceID string) *sessionv1.SessionSpec {
	spec := &sessionv1.SessionSpec{}
	if callerSpec != nil {
		spec = proto.Clone(callerSpec).(*sessionv1.SessionSpec)
	}
	if spec.AgentInstanceId == "" {
		spec.AgentInstanceId = defaultInstanceID
	}
	if spec.Subject == "" {
		spec.Subject = autoCreatedSessionSubject
	}
	return spec
}

// setInitialPhaseStep sets the execution phase to PENDING
//
// This allows the frontend to show a thinking indicator immediately when the execution is created,
// before the agent worker begins processing.
type setInitialPhaseStep struct{}

func newSetInitialPhaseStep() *setInitialPhaseStep {
	return &setInitialPhaseStep{}
}

func (s *setInitialPhaseStep) Name() string {
	return "SetInitialPhase"
}

func (s *setInitialPhaseStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()

	log.Debug().Msg("Setting execution phase to PENDING")

	// Set execution phase to PENDING
	if execution.Status == nil {
		execution.Status = &agentexecutionv1.AgentExecutionStatus{}
	}
	execution.Status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_PENDING

	// Update context with the modified execution
	ctx.SetNewState(execution)

	log.Debug().Msg("Execution phase set to EXECUTION_PENDING")

	return nil
}

// engineUnavailableMessage is the user-facing message returned when a create is
// rejected because the execution engine (Temporal) is not connected. Kept
// identical across AgentExecution and WorkflowExecution so both domains present
// one symmetric create-boundary contract.
const engineUnavailableMessage = "The execution engine is temporarily unavailable. Please try again shortly."

// ensureEngineAvailableStep rejects the create fast - before any persistence or
// side effect - when the Temporal workflow engine is not connected.
//
// workflowCreator is nil only during the startup window before the server's
// first Temporal connection; TemporalManager re-injects it on connect. Failing
// here with Unavailable (instead of persisting a PENDING execution that would
// never run) keeps the contract symmetric with WorkflowExecution: a create
// against an unavailable engine leaves no trace and tells the caller to retry.
//
// Placed after input validation but before the first side-effecting step, so a
// malformed request still gets InvalidArgument first and a down engine orphans
// nothing (no default instance, no auto-created session, no ExecutionContext,
// no execution record).
type ensureEngineAvailableStep struct {
	workflowCreator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator
}

func (c *AgentExecutionController) newEnsureEngineAvailableStep() *ensureEngineAvailableStep {
	return &ensureEngineAvailableStep{workflowCreator: c.workflowCreator}
}

func (s *ensureEngineAvailableStep) Name() string {
	return "EnsureEngineAvailable"
}

func (s *ensureEngineAvailableStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	if s.workflowCreator == nil {
		log.Warn().Msg("Agent execution engine unavailable - rejecting create before any state is persisted")
		return grpclib.UnavailableError(engineUnavailableMessage)
	}
	return nil
}

// startWorkflowStep starts the Temporal workflow for the execution.
//
// This step runs after the execution is persisted. Engine availability was
// already guaranteed by ensureEngineAvailableStep, so workflowCreator is
// non-nil here; a failure at this point is a live/transient Temporal error,
// which marks the execution FAILED (recoverable via Recover).
//
// This matches the Java AgentExecutionCreateHandler.StartWorkflowStep.
type startWorkflowStep struct {
	workflowCreator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator
	store           store.Store
	temporalConfig  *agentexecutiontemporal.Config
}

func (c *AgentExecutionController) newStartWorkflowStep() *startWorkflowStep {
	return &startWorkflowStep{
		workflowCreator: c.workflowCreator,
		store:           c.store,
		temporalConfig:  c.temporalConfig,
	}
}

func (s *startWorkflowStep) Name() string {
	return "StartWorkflow"
}

func (s *startWorkflowStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	executionID := execution.GetMetadata().GetId()

	// Log callback token if present (for async activity completion pattern)
	// See: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
	callbackToken := execution.GetSpec().GetCallbackToken()
	if len(callbackToken) > 0 {
		// Log token for debugging (Base64 encoded, truncated for security)
		tokenBase64 := base64.StdEncoding.EncodeToString(callbackToken)
		tokenPreview := tokenBase64
		if len(tokenPreview) > 20 {
			tokenPreview = tokenPreview[:20] + "..."
		}

		log.Info().
			Str("execution_id", executionID).
			Str("token_preview", tokenPreview).
			Int("token_length", len(callbackToken)).
			Msg("📝 Callback token present - workflow will complete external activity on finish")
	}

	log.Debug().
		Str("execution_id", executionID).
		Msg("Starting Temporal workflow")

	// Resolve dispatch: determines the Temporal task queue for activities
	dispatch, err := agentexecutiontemporal.ResolveActivityTaskQueue(
		ctx.Context(), s.store, execution.GetSpec().GetSessionId(), s.temporalConfig,
		execution.GetSpec().GetActivityTaskQueue())
	if err != nil {
		log.Warn().
			Err(err).
			Str("execution_id", executionID).
			Msg("Activity dispatch failed")
		return grpclib.WrapError(err, codes.FailedPrecondition, err.Error())
	}

	// Construct the slim workflow input from the execution.
	// Only orchestration coordinates are included; secrets (runtime_env)
	// have already been cleared by createExecutionContextStep.
	workflowInput := &workflows.InvokeAgentExecutionWorkflowInput{
		ExecutionID:      executionID,
		SessionID:        execution.GetSpec().GetSessionId(),
		AgentID:          execution.GetSpec().GetAgentId(),
		CallbackToken:    execution.GetSpec().GetCallbackToken(),
		AutoApproveAll:   execution.GetSpec().GetAutoApproveAll(),
		ParentWorkflowID: execution.GetSpec().GetParentWorkflowId(),
		Harness:          int32(dispatch.Harness),
		ExecutionTarget:  int32(dispatch.ExecutionTarget),
	}

	// Start the Temporal workflow with slim input and dispatch routing
	if err := s.workflowCreator.Create(workflowInput, &dispatch); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to start Temporal workflow - marking execution as FAILED")

		// Mark execution as FAILED and persist
		if execution.Status == nil {
			execution.Status = &agentexecutionv1.AgentExecutionStatus{}
		}
		execution.Status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_FAILED
		execution.Status.Error = fmt.Sprintf("Failed to start Temporal workflow: %v", err)

		// Persist the failed state. Whole-resource save is intentional (exempt from
		// the atomic UpdateStatus path): this is the creation path marking a brand-new
		// execution FAILED because its workflow never started — no approval gate has
		// ever existed, so there is no approval_event_stream to preserve and no
		// concurrent appender to lose a write to.
		kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
		if updateErr := s.store.SaveResource(ctx.Context(), kind, executionID, execution); updateErr != nil {
			log.Error().
				Err(updateErr).
				Str("execution_id", executionID).
				Msg("Failed to update execution status after workflow start failure")
			return grpclib.InternalError(updateErr, "failed to start workflow and failed to update status")
		}

		return grpclib.InternalError(err, "failed to start workflow")
	}

	log.Info().
		Str("execution_id", executionID).
		Msg("Temporal workflow started successfully")

	return nil
}

// processAttachmentsStep validates attachments have required storage_key.
//
// All attachments must be pre-uploaded via the uploadAttachment RPC.
// This step validates that each attachment has a storage_key reference.
type processAttachmentsStep struct{}

func (c *AgentExecutionController) newProcessAttachmentsStep() *processAttachmentsStep {
	return &processAttachmentsStep{}
}

func (s *processAttachmentsStep) Name() string {
	return "ProcessAttachments"
}

func (s *processAttachmentsStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	attachments := execution.GetSpec().GetAttachments()

	if len(attachments) == 0 {
		log.Debug().Msg("No attachments to process")
		return nil
	}

	for _, attachment := range attachments {
		if attachment.GetStorageKey() == "" {
			log.Error().
				Str("filename", attachment.GetFilename()).
				Msg("Attachment missing storage_key - all attachments must be pre-uploaded via uploadAttachment RPC")
			return grpclib.InvalidArgumentError(
				"attachment '%s' missing storage_key: all attachments must be pre-uploaded via uploadAttachment RPC",
				attachment.GetFilename(),
			)
		}

		log.Debug().
			Str("filename", attachment.GetFilename()).
			Str("storage_key", attachment.GetStorageKey()).
			Msg("Attachment validated")
	}

	log.Info().
		Int("attachment_count", len(attachments)).
		Msg("All attachments validated successfully")

	return nil
}
