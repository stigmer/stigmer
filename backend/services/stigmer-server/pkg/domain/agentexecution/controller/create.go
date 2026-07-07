package agentexecution

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
	"google.golang.org/grpc/codes"
)

// Context keys for inter-step communication
const (
	DefaultInstanceIDKey = "default_instance_id"
	CreatedSessionIDKey  = "created_session_id"
)

// Create creates a new agent execution using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveDefaultAgent - If no session_id or agent_id, resolve platform default agent
// 3. ValidateSessionOrAgent - Ensure session_id OR agent_id is provided
// 4. ResolveSlug - Generate slug from metadata.name
// 5. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 6. NormalizeReferences - Resolve cross-references (slugs to IDs)
// 7. EnsureEngineAvailable - Fail fast with Unavailable if the agent execution engine is not connected (before the first side effect)
// 8. CreateDefaultInstanceIfNeeded - Create default agent instance if missing
// 9. CreateSessionIfNeeded - Create session if session_id not provided (uses caller's org)
// 10. SetInitialPhase - Set execution phase to PENDING
// 11. CreateExecutionContext - Merge environment into execution context
// 12. ProcessAttachments - Validate pre-uploaded attachments
// 13. Persist - Save execution to repository
// 14. IndexSearch - Update search index
// 15. StartWorkflow - Start Temporal workflow
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
		AddStep(newResolveDefaultAgentStep(c.store)).                                                                       // 2. Resolve platform default agent if needed
		AddStep(newValidateSessionOrAgentStep()).                                                                           // 3. Validate session_id OR agent_id
		AddStep(steps.NewResolveSlugStep[*agentexecutionv1.AgentExecution]()).                                              // 4. Resolve slug
		AddStep(steps.NewBuildNewStateStep[*agentexecutionv1.AgentExecution]()).                                            // 5. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*agentexecutionv1.AgentExecution]()).                                      // 6. Normalize cross-references
		AddStep(c.newEnsureEngineAvailableStep()).                                                                          // 7. Fail fast if the agent execution engine is unavailable (before the first side effect)
		AddStep(newCreateDefaultInstanceIfNeededStep(c.agentClient, c.agentInstanceClient, c.store)).                       // 8. Create default instance if needed
		AddStep(newCreateSessionIfNeededStep(c.sessionClient)).                                                             // 9. Create session if needed
		AddStep(newSetInitialPhaseStep()).                                                                                  // 10. Set phase to PENDING
		AddStep(c.newCreateExecutionContextStep()).                                                                         // 11. Create ExecutionContext with merged environment
		AddStep(c.newProcessAttachmentsStep()).                                                                             // 12. Process attachments
		AddStep(steps.NewPersistStep[*agentexecutionv1.AgentExecution](c.store)).                                           // 13. Persist execution
		AddStep(steps.NewIndexSearchStep[*agentexecutionv1.AgentExecution](c.store, &extractor.AgentExecutionExtractor{})). // 14. Update search index
		AddStep(c.newStartWorkflowStep()).                                                                                  // 15. Start Temporal workflow
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java AgentExecutionCreateHandler pattern)
// ============================================================================

// resolveDefaultAgentStep resolves the platform's public default agent when
// neither session_id nor agent_id is provided on the execution request.
//
// The default agent is a platform-level concept: an agent in the stigmer org
// labeled stigmer.ai/default-agent: "true" with visibility_public. This enables
// the session-first UX where users start a conversation without choosing an agent.
//
// If session_id or agent_id is already provided, this step is a no-op.
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

	if sessionID != "" || agentID != "" {
		return nil
	}

	log.Info().Msg("Neither session_id nor agent_id provided, resolving platform default agent")

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
		log.Error().
			Str("agent_id", defaultAgent.GetMetadata().GetId()).
			Str("visibility", defaultAgent.GetMetadata().GetVisibility().String()).
			Msg("Default agent is not visibility_public")
		return grpclib.WrapError(
			fmt.Errorf("default agent is not publicly accessible"),
			codes.FailedPrecondition,
			"Default agent exists but is not visibility_public",
		)
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

// validateSessionOrAgentStep validates that at least one of session_id or agent_id is provided
type validateSessionOrAgentStep struct{}

func newValidateSessionOrAgentStep() *validateSessionOrAgentStep {
	return &validateSessionOrAgentStep{}
}

func (s *validateSessionOrAgentStep) Name() string {
	return "ValidateSessionOrAgent"
}

func (s *validateSessionOrAgentStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	sessionID := execution.GetSpec().GetSessionId()
	agentID := execution.GetSpec().GetAgentId()

	log.Debug().
		Str("session_id", sessionID).
		Str("agent_id", agentID).
		Msg("Validating session_id or agent_id")

	// At least one must be provided
	hasSessionID := sessionID != ""
	hasAgentID := agentID != ""

	if !hasSessionID && !hasAgentID {
		log.Warn().Msg("Neither session_id nor agent_id provided")
		return grpclib.InvalidArgumentError("either session_id or agent_id must be provided")
	}

	log.Debug().
		Bool("has_session_id", hasSessionID).
		Bool("has_agent_id", hasAgentID).
		Msg("Validation successful")

	return nil
}

// createDefaultInstanceIfNeededStep creates default agent instance if agent doesn't have one
//
// This step:
// 1. Skips if session_id is provided (no need for agent operations)
// 2. Loads agent by agent_id
// 3. Checks if agent has default_instance_id in status
// 4. If missing, creates default instance (similar to AgentCreateHandler)
// 5. Updates agent status with default_instance_id
// 6. Stores default_instance_id in context for next step
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

	// Use agent's name (matching Java implementation)
	// Java: String agentSlug = agent.getMetadata().getName();
	agentSlug := agent.GetMetadata().GetName()
	agentOrg := agent.GetMetadata().GetOrg()

	instanceMetadataBuilder := &apiresource.ApiResourceMetadata{
		Name: agentSlug + "-default",
		Org:  agentOrg, // All resources belong to an org
	}

	instanceRequest := &agentinstancev1.AgentInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentInstance",
		Metadata:   instanceMetadataBuilder,
		Spec: &agentinstancev1.AgentInstanceSpec{
			AgentId:     agentID,
			Description: "Default instance (auto-created, no custom configuration)",
		},
	}

	log.Debug().
		Str("agent_id", agentID).
		Msg("Built default instance request")

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
// 1. Skips if session_id is provided
// 2. Gets default_instance_id from context (set by previous step)
// 3. Uses the caller's org from execution metadata for session ownership
// 4. Creates session with default instance ID
// 5. Updates execution request with created session_id
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

	log.Info().
		Str("agent_id", agentID).
		Msg("Session ID not provided, auto-creating session")

	// 1. Get default_instance_id from context (set by previous step)
	defaultInstanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
	if !ok || defaultInstanceID == "" {
		log.Error().
			Str("agent_id", agentID).
			Msg("DEFAULT_INSTANCE_ID not found in context")
		return fmt.Errorf("default instance ID not found in context")
	}

	log.Debug().
		Str("default_instance_id", defaultInstanceID).
		Msg("Using default instance from context for session creation")

	// 2. Determine session org: use the caller's org from the execution metadata,
	// not the agent's org. This ensures sessions are owned by the caller even when
	// using a cross-org public agent (e.g., the platform default assistant).
	orgID := ctx.NewState().GetMetadata().GetOrg()
	if orgID == "" {
		orgID = ctx.Input().GetMetadata().GetOrg()
	}

	// 3. Build session request with default instance
	sessionMetadataBuilder := &apiresource.ApiResourceMetadata{
		Name: fmt.Sprintf("session-%d", time.Now().UnixMilli()), // Auto-generated name
		Org:  orgID,                                             // All resources belong to an org
	}

	sessionRequest := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata:   sessionMetadataBuilder,
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: defaultInstanceID,
			Subject:         "Auto-created session",
		},
	}

	log.Debug().
		Str("agent_id", agentID).
		Str("instance_id", defaultInstanceID).
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
		Str("instance_id", defaultInstanceID).
		Msg("Successfully auto-created session")

	// 5. Update execution request with created session_id
	if execution.Spec == nil {
		execution.Spec = &agentexecutionv1.AgentExecutionSpec{}
	}
	execution.Spec.SessionId = sessionID

	ctx.SetNewState(execution)

	// 6. Store session ID in context for tracking
	ctx.Set(CreatedSessionIDKey, sessionID)

	log.Debug().
		Str("session_id", sessionID).
		Msg("Updated execution request with session_id")

	return nil
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
