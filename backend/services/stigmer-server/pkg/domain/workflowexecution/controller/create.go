package workflowexecution

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Context keys for inter-step communication
const (
	ResolvedWorkflowInstanceIDKey = "resolved_workflow_instance_id"
)

// Create creates a new workflow execution using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. ValidateWorkflowOrInstance - Ensure workflow_id OR workflow_instance_id is provided
// 4. CreateDefaultInstanceIfNeeded - Auto-create default instance if workflow_id is used
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
		AddStep(steps.NewResolveSlugStep[*workflowexecutionv1.WorkflowExecution]()).                     // 2. Resolve slug
		AddStep(newValidateWorkflowOrInstanceStep()).                                                    // 3. Validate workflow_id OR workflow_instance_id
		AddStep(newCreateDefaultInstanceIfNeededStep(c.workflowInstanceClient, c.store)).               // 4. Create default instance if needed
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
// 3. If missing, look up instance by slug ({workflow-slug}-default)
// 4. If found, update workflow status with instance ID and use it (handles recovery from failed status update)
// 5. If not found, create new default instance
// 6. Update workflow status with new instance ID
// 7. Update execution.spec.workflow_instance_id with resolved instance ID
//
// This resilient approach handles the edge case where the default instance was created
// but the workflow status update failed, preventing duplicate instance creation errors.
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
	// Check the input to see if workflow_instance_id was provided
	input := ctx.Input()
	workflowInstanceID := input.GetSpec().GetWorkflowInstanceId()
	workflowID := input.GetSpec().GetWorkflowId()

	// If workflow_instance_id is provided, skip this step
	if workflowInstanceID != "" {
		log.Debug().
			Str("workflow_instance_id", workflowInstanceID).
			Msg("Workflow instance ID already provided, skipping default instance check")
		return nil
	}
	
	// Get the execution state to modify if needed
	execution := ctx.NewState()

	log.Debug().
		Str("workflow_id", workflowID).
		Msg("Checking if workflow has default instance")

	// 1. Load workflow by ID from store
	workflow := &workflowv1.Workflow{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, workflow); err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Workflow not found")
		return grpclib.NotFoundError("Workflow", workflowID)
	}

	defaultInstanceID := workflow.GetStatus().GetDefaultInstanceId()

	// 2. Check if default instance ID is set in workflow status
	if defaultInstanceID != "" {
		log.Debug().
			Str("default_instance_id", defaultInstanceID).
			Str("workflow_id", workflowID).
			Msg("Workflow already has default instance in status")

		// Update execution with resolved instance ID
		execution.Spec.WorkflowInstanceId = defaultInstanceID
		ctx.SetNewState(execution)
		return nil
	}

	// 3. Default instance ID not set - check if instance exists by slug
	// This handles the case where instance was created but workflow status update failed
	workflowSlug := workflow.GetMetadata().GetName()
	defaultInstanceSlug := workflowSlug + "-default"

	log.Debug().
		Str("workflow_id", workflowID).
		Str("default_instance_slug", defaultInstanceSlug).
		Msg("Default instance ID not set in workflow status, checking if instance exists by slug")

	existingInstance, err := s.findInstanceBySlug(ctx.Context(), defaultInstanceSlug)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Str("slug", defaultInstanceSlug).
			Msg("Failed to look up existing default instance")
		return fmt.Errorf("failed to look up existing default instance: %w", err)
	}

	// 4. If instance exists, update workflow status and use it
	if existingInstance != nil {
		existingInstanceID := existingInstance.GetMetadata().GetId()
		log.Info().
			Str("instance_id", existingInstanceID).
			Str("workflow_id", workflowID).
			Msg("Found existing default instance, updating workflow status")

		// Update workflow status with found instance ID
		if workflow.Status == nil {
			workflow.Status = &workflowv1.WorkflowStatus{}
		}
		workflow.Status.DefaultInstanceId = existingInstanceID

		// Save workflow with updated status
		if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, workflow); err != nil {
			log.Error().
				Err(err).
				Str("workflow_id", workflowID).
				Msg("Failed to update workflow status with existing default_instance_id")
			return fmt.Errorf("failed to update workflow with existing default instance: %w", err)
		}

		log.Debug().
			Str("workflow_id", workflowID).
			Str("default_instance_id", existingInstanceID).
			Msg("Updated workflow status with existing default_instance_id")

		// Update execution with resolved instance ID
		execution.Spec.WorkflowInstanceId = existingInstanceID
		ctx.SetNewState(execution)

		log.Info().
			Str("instance_id", existingInstanceID).
			Str("workflow_id", workflowID).
			Msg("Successfully resolved existing default instance")

		return nil
	}

	// 5. Default instance doesn't exist - create it
	log.Info().
		Str("workflow_id", workflowID).
		Msg("Default instance not found, creating new one")

	ownerScope := workflow.GetMetadata().GetOwnerScope()

	instanceMetadata := &apiresource.ApiResourceMetadata{
		Name:       defaultInstanceSlug,
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

	// 6. Create instance via downstream gRPC (system context)
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

	// 7. Update workflow status with default_instance_id
	if workflow.Status == nil {
		workflow.Status = &workflowv1.WorkflowStatus{}
	}
	workflow.Status.DefaultInstanceId = createdInstanceID

	// Save workflow with updated status
	if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, workflow); err != nil {
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

	// 8. Update execution with resolved instance ID
	execution.Spec.WorkflowInstanceId = createdInstanceID
	ctx.SetNewState(execution)

	log.Info().
		Str("instance_id", createdInstanceID).
		Str("workflow_id", workflowID).
		Msg("Successfully created and registered default instance")

	return nil
}

// findInstanceBySlug searches for a workflow instance by slug
// Returns the instance if found, nil if not found, or error if lookup fails
func (s *createDefaultInstanceIfNeededStep) findInstanceBySlug(ctx context.Context, slug string) (*workflowinstancev1.WorkflowInstance, error) {
	// List all workflow instances
	instances, err := s.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_instance)
	if err != nil {
		return nil, fmt.Errorf("failed to list workflow instances: %w", err)
	}

	// Search for matching slug
	for _, data := range instances {
		instance := &workflowinstancev1.WorkflowInstance{}
		if err := instance.Unmarshal(data); err != nil {
			// Skip instances that can't be unmarshaled
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal workflow instance during slug lookup")
			continue
		}

		if instance.GetMetadata() != nil && instance.GetMetadata().GetSlug() == slug {
			return instance, nil
		}
	}

	return nil, nil
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
