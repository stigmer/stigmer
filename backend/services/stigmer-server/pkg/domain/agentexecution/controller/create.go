package agentexecution

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session"
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
// 2. ResolveSlug - Generate slug from metadata.name
// 3. ValidateSessionOrAgent - Ensure session_id OR agent_id is provided
// 4. CheckDuplicate - Skip (executions don't need duplicate check)
// 5. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 6. CreateDefaultInstanceIfNeeded - Create default agent instance if missing
// 7. CreateSessionIfNeeded - Create session if session_id not provided
// 8. SetInitialPhase - Set execution phase to PENDING
// 9. Persist - Save execution to repository
// 10. StartWorkflow - Start Temporal workflow (if Temporal is available)
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
		AddStep(steps.NewValidateProtoStep[*agentexecutionv1.AgentExecution]()).             // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*agentexecutionv1.AgentExecution]()).               // 2. Resolve slug
		AddStep(newValidateSessionOrAgentStep()).                                            // 3. Validate session_id OR agent_id
		AddStep(steps.NewBuildNewStateStep[*agentexecutionv1.AgentExecution]()).             // 4. Build new state
		AddStep(newCreateDefaultInstanceIfNeededStep(c.agentClient, c.agentInstanceClient)). // 5. Create default instance if needed
		AddStep(newCreateSessionIfNeededStep(c.agentClient, c.sessionClient)).               // 6. Create session if needed
		AddStep(newSetInitialPhaseStep()).                                                   // 7. Set phase to PENDING
		AddStep(steps.NewPersistStep[*agentexecutionv1.AgentExecution](c.store)).            // 8. Persist execution
		AddStep(c.newStartWorkflowStep()).                                                   // 9. Start Temporal workflow
		Build()
}

// ============================================================================
// Helper Functions
// ============================================================================

// isAlreadyExistsError checks if an error is due to a duplicate resource
// by looking for "already exists" in the error message.
//
// This is used to handle the case where a default instance exists but the
// agent status wasn't updated with the instance ID.
func isAlreadyExistsError(err error) bool {
	if err == nil {
		return false
	}
	errMsg := strings.ToLower(err.Error())
	return strings.Contains(errMsg, "already exists")
}

// ============================================================================
// Pipeline Steps (inline implementations following Java AgentExecutionCreateHandler pattern)
// ============================================================================

// validateSessionOrAgentStep validates that at least one of session_id or agent_id is provided
type validateSessionOrAgentStep struct{}

func newValidateSessionOrAgentStep() *validateSessionOrAgentStep {
	return &validateSessionOrAgentStep{}
}

func (s *validateSessionOrAgentStep) Name() string {
	return "ValidateSessionOrAgent"
}

func (s *validateSessionOrAgentStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.Input()
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
}

func newCreateDefaultInstanceIfNeededStep(
	agentClient *agent.Client,
	agentInstanceClient *agentinstance.Client,
) *createDefaultInstanceIfNeededStep {
	return &createDefaultInstanceIfNeededStep{
		agentClient:         agentClient,
		agentInstanceClient: agentInstanceClient,
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

	// Use agent's slug (not name) to build the default instance slug
	// This ensures we're comparing the same normalized values
	agentSlug := agent.GetMetadata().GetSlug()
	ownerScope := agent.GetMetadata().GetOwnerScope()

	instanceMetadataBuilder := &apiresource.ApiResourceMetadata{
		Name:       agentSlug + "-default",
		OwnerScope: ownerScope,
	}

	// Copy org if org-scoped
	if ownerScope == apiresource.ApiResourceOwnerScope_organization {
		instanceMetadataBuilder.Org = agent.GetMetadata().GetOrg()
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
		// Check if error is due to duplicate slug
		// If so, fetch existing instance instead of failing
		if isAlreadyExistsError(err) {
			log.Warn().
				Err(err).
				Str("agent_id", agentID).
				Str("expected_slug", agentSlug+"-default").
				Msg("Default instance already exists, fetching existing instance")

			// Fetch all instances for this agent
			instanceList, fetchErr := s.agentInstanceClient.GetByAgent(ctx.Context(), agentID)
			if fetchErr != nil {
				log.Error().
					Err(fetchErr).
					Str("agent_id", agentID).
					Msg("Failed to fetch existing instances after duplicate error")
				return fmt.Errorf("failed to fetch existing instances: %w", fetchErr)
			}

			// Find the default instance by slug (not name!)
			// The duplicate check uses metadata.slug, so we must search by slug too
			var defaultInstance *agentinstancev1.AgentInstance
			expectedSlug := agentSlug + "-default"
			for _, instance := range instanceList.GetItems() {
				// FIXED: Compare against Slug field, not Name field
				if instance.GetMetadata().GetSlug() == expectedSlug {
					defaultInstance = instance
					break
				}
			}

			if defaultInstance == nil {
				log.Error().
					Str("agent_id", agentID).
					Str("expected_slug", expectedSlug).
					Int32("instances_found", instanceList.GetTotalCount()).
					Msg("Default instance not found despite duplicate error")
				return fmt.Errorf("default instance '%s' not found despite duplicate error", expectedSlug)
			}

			createdInstance = defaultInstance
			log.Info().
				Str("instance_id", defaultInstance.GetMetadata().GetId()).
				Str("slug", expectedSlug).
				Str("agent_id", agentID).
				Msg("Found existing default instance")
		} else {
			log.Error().
				Err(err).
				Str("agent_id", agentID).
				Msg("Failed to create default instance")
			return fmt.Errorf("failed to create default instance: %w", err)
		}
	} else {
		log.Info().
			Str("instance_id", createdInstance.GetMetadata().GetId()).
			Str("agent_id", agentID).
			Msg("Successfully created default instance")
	}

	createdInstanceID := createdInstance.GetMetadata().GetId()

	// 5. Update agent status with default_instance_id
	if agent.Status == nil {
		agent.Status = &agentv1.AgentStatus{}
	}
	agent.Status.DefaultInstanceId = createdInstanceID

	// Update agent via in-process gRPC (single source of truth)
	// Note: We use the agent client's Update method which ensures all interceptors
	// run with the correct api_resource_kind (AGENT), not the current request's kind
	_, err = s.agentClient.Update(ctx.Context(), agent)
	if err != nil {
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
// 3. Loads agent metadata for session scope
// 4. Creates session with default instance ID
// 5. Updates execution request with created session_id
type createSessionIfNeededStep struct {
	agentClient   *agent.Client
	sessionClient *session.Client
}

func newCreateSessionIfNeededStep(
	agentClient *agent.Client,
	sessionClient *session.Client,
) *createSessionIfNeededStep {
	return &createSessionIfNeededStep{
		agentClient:   agentClient,
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

	// 2. Load agent for metadata (scope, org) via in-process gRPC (single source of truth)
	agent, err := s.agentClient.Get(ctx.Context(), &agentv1.AgentId{Value: agentID})
	if err != nil {
		log.Error().
			Err(err).
			Str("agent_id", agentID).
			Msg("Agent not found")
		return err // Already a gRPC error from the client
	}

	ownerScope := agent.GetMetadata().GetOwnerScope()
	orgID := agent.GetMetadata().GetOrg()

	// 3. Build session request with default instance
	sessionMetadataBuilder := &apiresource.ApiResourceMetadata{
		Name:       fmt.Sprintf("session-%d", time.Now().UnixMilli()), // Auto-generated name
		OwnerScope: ownerScope,
	}

	// Copy org if org-scoped
	if ownerScope == apiresource.ApiResourceOwnerScope_organization && orgID != "" {
		sessionMetadataBuilder.Org = orgID
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

// startWorkflowStep starts the Temporal workflow for the execution.
//
// This step is executed after the execution is persisted to the database.
// If no Temporal client is available (workflowCreator is nil), the step logs a warning
// and continues gracefully - the execution remains in PENDING phase.
//
// This matches the Java AgentExecutionCreateHandler.StartWorkflowStep.
type startWorkflowStep struct {
	workflowCreator *agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator
	store           *badger.Store
}

func (c *AgentExecutionController) newStartWorkflowStep() *startWorkflowStep {
	return &startWorkflowStep{
		workflowCreator: c.workflowCreator,
		store:           c.store,
	}
}

func (s *startWorkflowStep) Name() string {
	return "StartWorkflow"
}

func (s *startWorkflowStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	executionID := execution.GetMetadata().GetId()

	// Check if Temporal client is available
	if s.workflowCreator == nil {
		log.Warn().
			Str("execution_id", executionID).
			Msg("Workflow creator not available - execution will remain in PENDING (Temporal not connected)")
		return nil
	}

	log.Debug().
		Str("execution_id", executionID).
		Msg("Starting Temporal workflow")

	// Start the Temporal workflow
	if err := s.workflowCreator.Create(execution); err != nil {
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

		// Persist the failed state
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
