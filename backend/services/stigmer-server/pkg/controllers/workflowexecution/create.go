package workflowexecution

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	workflowv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Context keys for inter-step communication
const (
	ResolvedWorkflowInstanceIDKey = "resolved_workflow_instance_id"
)

// Create creates a new workflow execution using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ValidateWorkflowOrInstance - Ensure workflow_id OR workflow_instance_id is provided
// 3. CreateDefaultInstanceIfNeeded - Auto-create default instance if workflow_id is used
// 4. ResolveSlug - Generate slug from metadata.name
// 5. CheckDuplicate - Verify no duplicate exists
// 6. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 7. SetInitialPhase - Set execution phase to PENDING
// 8. Persist - Save execution to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - AuthorizeExecution step (no can_execute permission check in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - StartWorkflow step (no Temporal workflow engine in OSS - stubbed for now)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
//
// Instance Resolution (matches AgentExecution pattern):
// - If workflow_instance_id provided: Use it directly
// - If workflow_id provided: Resolve to default instance (auto-create if missing)
// - Handler enforces: at least one must be provided
func (c *WorkflowExecutionController) Create(ctx context.Context, execution *workflowexecutionv1.WorkflowExecution) (*workflowexecutionv1.WorkflowExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, execution)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for workflow execution creation
func (c *WorkflowExecutionController) buildCreatePipeline() *pipeline.Pipeline[*workflowexecutionv1.WorkflowExecution] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*workflowexecutionv1.WorkflowExecution]("workflowexecution-create").
		AddStep(steps.NewValidateProtoStep[*workflowexecutionv1.WorkflowExecution]()).                   // 1. Validate field constraints
		AddStep(newValidateWorkflowOrInstanceStep()).                                                    // 2. Validate workflow_id OR workflow_instance_id
		AddStep(newCreateDefaultInstanceIfNeededStep(c.workflowInstanceClient, c.store)).               // 3. Create default instance if needed
		AddStep(steps.NewResolveSlugStep[*workflowexecutionv1.WorkflowExecution]()).                     // 4. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*workflowexecutionv1.WorkflowExecution](c.store)).           // 5. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*workflowexecutionv1.WorkflowExecution]()).                   // 6. Build new state
		AddStep(newSetInitialPhaseStep()).                                                               // 7. Set phase to PENDING
		AddStep(steps.NewPersistStep[*workflowexecutionv1.WorkflowExecution](c.store)).                  // 8. Persist execution
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java WorkflowExecutionCreateHandler pattern)
// ============================================================================

// validateWorkflowOrInstanceStep validates that at least one of workflow_id or workflow_instance_id is provided.
//
// Matches the pattern from Java AgentExecutionCreateHandler (session_id or agent_id) and
// WorkflowExecutionCreateHandler (workflow_id or workflow_instance_id).
type validateWorkflowOrInstanceStep struct{}

func newValidateWorkflowOrInstanceStep() *validateWorkflowOrInstanceStep {
	return &validateWorkflowOrInstanceStep{}
}

func (s *validateWorkflowOrInstanceStep) Name() string {
	return "ValidateWorkflowOrInstance"
}

func (s *validateWorkflowOrInstanceStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution]) error {
	execution := ctx.Input()
	workflowInstanceID := execution.GetSpec().GetWorkflowInstanceId()
	workflowID := execution.GetSpec().GetWorkflowId()

	log.Debug().
		Str("workflow_id", workflowID).
		Str("workflow_instance_id", workflowInstanceID).
		Msg("Validating workflow_id or workflow_instance_id")

	// At least one must be provided
	hasWorkflowInstanceID := workflowInstanceID != ""
	hasWorkflowID := workflowID != ""

	if !hasWorkflowInstanceID && !hasWorkflowID {
		log.Warn().Msg("Neither workflow_id nor workflow_instance_id provided")
		return grpclib.InvalidArgumentError("either workflow_id or workflow_instance_id must be provided")
	}

	log.Debug().
		Bool("has_workflow_id", hasWorkflowID).
		Bool("has_workflow_instance_id", hasWorkflowInstanceID).
		Msg("Validation successful")

	return nil
}

// createDefaultInstanceIfNeededStep creates default workflow instance if workflow doesn't have one.
//
// When workflow_instance_id is not provided but workflow_id is:
// 1. Load workflow by workflow_id
// 2. Check if workflow has default_instance_id in status
// 3. If missing, create default instance
// 4. Update workflow status with default_instance_id
// 5. Update execution.spec.workflow_instance_id with resolved instance ID
//
// This step matches the Java WorkflowExecutionCreateHandler.CreateDefaultInstanceIfNeededStep.
type createDefaultInstanceIfNeededStep struct {
	workflowInstanceClient *workflowinstance.Client
	store                  *badger.Store
}

func newCreateDefaultInstanceIfNeededStep(
	workflowInstanceClient *workflowinstance.Client,
	store *badger.Store,
) *createDefaultInstanceIfNeededStep {
	return &createDefaultInstanceIfNeededStep{
		workflowInstanceClient: workflowInstanceClient,
		store:                  store,
	}
}

func (s *createDefaultInstanceIfNeededStep) Name() string {
	return "CreateDefaultInstanceIfNeeded"
}

func (s *createDefaultInstanceIfNeededStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution]) error {
	execution := ctx.NewState()
	workflowInstanceID := execution.GetSpec().GetWorkflowInstanceId()
	workflowID := execution.GetSpec().GetWorkflowId()

	// If workflow_instance_id is provided, skip this step
	if workflowInstanceID != "" {
		log.Debug().
			Str("workflow_instance_id", workflowInstanceID).
			Msg("Workflow instance ID already provided, skipping default instance check")
		return nil
	}

	log.Debug().
		Str("workflow_id", workflowID).
		Msg("Checking if workflow has default instance")

	// 1. Load workflow by ID from store
	workflow := &workflowv1.Workflow{}
	if err := s.store.GetResource(ctx.Context(), "Workflow", workflowID, workflow); err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Workflow not found")
		return grpclib.NotFoundError("Workflow", workflowID)
	}

	defaultInstanceID := workflow.GetStatus().GetDefaultInstanceId()

	// 2. Check if default instance exists
	if defaultInstanceID != "" {
		log.Debug().
			Str("default_instance_id", defaultInstanceID).
			Str("workflow_id", workflowID).
			Msg("Workflow already has default instance")

		// Update execution with resolved instance ID
		execution.Spec.WorkflowInstanceId = defaultInstanceID
		ctx.SetNewState(execution)
		return nil
	}

	// 3. Default instance missing - create it
	log.Info().
		Str("workflow_id", workflowID).
		Msg("Workflow missing default instance, creating one")

	workflowSlug := workflow.GetMetadata().GetName()
	ownerScope := workflow.GetMetadata().GetOwnerScope()

	instanceMetadata := &apiresource.ApiResourceMetadata{
		Name:       workflowSlug + "-default",
		OwnerScope: ownerScope,
	}

	// Copy org if org-scoped
	if ownerScope == apiresource.ApiResourceOwnerScope_organization {
		instanceMetadata.Org = workflow.GetMetadata().GetOrg()
	}

	instanceRequest := &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata:   instanceMetadata,
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId:  workflowID,
			Description: "Default instance (auto-created, no custom configuration)",
		},
	}

	log.Debug().
		Str("workflow_id", workflowID).
		Str("instance_name", instanceMetadata.Name).
		Msg("Built default instance request")

	// 4. Create instance via downstream gRPC (system context)
	createdInstance, err := s.workflowInstanceClient.CreateAsSystem(ctx.Context(), instanceRequest)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Failed to create default instance")
		return fmt.Errorf("failed to create default workflow instance: %w", err)
	}

	createdInstanceID := createdInstance.GetMetadata().GetId()

	log.Info().
		Str("instance_id", createdInstanceID).
		Str("workflow_id", workflowID).
		Msg("Successfully created default instance")

	// 5. Update workflow status with default_instance_id
	if workflow.Status == nil {
		workflow.Status = &workflowv1.WorkflowStatus{}
	}
	workflow.Status.DefaultInstanceId = createdInstanceID

	// Save workflow with updated status
	// Use "Workflow" as the kind (same as the resource type)
	if err := s.store.SaveResource(ctx.Context(), "Workflow", workflowID, workflow); err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Failed to update workflow status with default_instance_id")
		return fmt.Errorf("failed to update workflow with default instance: %w", err)
	}

	log.Debug().
		Str("workflow_id", workflowID).
		Str("default_instance_id", createdInstanceID).
		Msg("Updated workflow status with default_instance_id")

	// 6. Update execution with resolved instance ID
	execution.Spec.WorkflowInstanceId = createdInstanceID
	ctx.SetNewState(execution)

	log.Info().
		Str("instance_id", createdInstanceID).
		Str("workflow_id", workflowID).
		Msg("Successfully ensured default instance exists")

	return nil
}

// setInitialPhaseStep sets initial execution phase to PENDING.
//
// This allows the frontend to show a thinking indicator immediately when the execution is created,
// before the Temporal workflow starts and the worker begins processing.
//
// This step matches the Java WorkflowExecutionCreateHandler.SetInitialPhaseStep.
type setInitialPhaseStep struct{}

func newSetInitialPhaseStep() *setInitialPhaseStep {
	return &setInitialPhaseStep{}
}

func (s *setInitialPhaseStep) Name() string {
	return "SetInitialPhase"
}

func (s *setInitialPhaseStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution]) error {
	execution := ctx.NewState()

	log.Debug().Msg("Setting execution phase to PENDING")

	// Set execution phase to PENDING
	// Preserve existing status by starting from the current state to avoid losing audit timestamps
	if execution.Status == nil {
		execution.Status = &workflowexecutionv1.WorkflowExecutionStatus{}
	}
	execution.Status.Phase = workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING

	// Update context with the modified execution
	ctx.SetNewState(execution)

	log.Debug().Msg("Execution phase set to EXECUTION_PENDING")

	return nil
}
