package workflow

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// Context keys for inter-step communication
const (
	DefaultInstanceIDKey = "default_instance_id"
)

// Create creates a new workflow using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. CheckDuplicate - Verify no duplicate exists
// 4. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 5. Persist - Save workflow to repository
// 6. CreateDefaultInstance - Create default workflow instance
// 7. UpdateWorkflowStatusWithDefaultInstance - Update workflow status with default_instance_id
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - ValidateWorkflowSpec step (workflow spec validation via Temporal - not yet implemented in OSS)
// - PopulateServerlessValidation step (depends on ValidateWorkflowSpec)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *WorkflowController) Create(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflow)
	reqCtx.SetNewState(workflow)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for workflow creation
func (c *WorkflowController) buildCreatePipeline() *pipeline.Pipeline[*workflowv1.Workflow] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*workflowv1.Workflow]("workflow-create").
		AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]()).          // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*workflowv1.Workflow]()).            // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*workflowv1.Workflow](c.store)).  // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*workflowv1.Workflow]()).          // 4. Build new state
		AddStep(steps.NewPersistStep[*workflowv1.Workflow](c.store)).         // 5. Persist workflow
		AddStep(newCreateDefaultInstanceStep(c.workflowInstanceClient)).      // 6. Create default instance
		AddStep(newUpdateWorkflowStatusWithDefaultInstanceStep(c.store)).     // 7. Update status
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java WorkflowCreateHandler pattern)
// ============================================================================

// createDefaultInstanceStep creates a default workflow instance for the newly created workflow.
//
// This step:
// 1. Builds WorkflowInstance request with no environment_refs
// 2. Calls WorkflowInstanceController via in-process client (similar to Java's WorkflowInstanceGrpcRepo)
// 3. Stores returned default_instance_id in context for next step
//
// Architecture note: Uses downstream client to maintain domain separation.
// The workflow instance creation handler handles all persistence and validation.
// This step does NOT update workflow status - that's done in updateWorkflowStatusWithDefaultInstanceStep.
type createDefaultInstanceStep struct {
	workflowInstanceClient *workflowinstance.Client
}

func newCreateDefaultInstanceStep(workflowInstanceClient *workflowinstance.Client) *createDefaultInstanceStep {
	return &createDefaultInstanceStep{workflowInstanceClient: workflowInstanceClient}
}

func (s *createDefaultInstanceStep) Name() string {
	return "CreateDefaultInstance"
}

func (s *createDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	workflow := ctx.NewState()
	workflowID := workflow.GetMetadata().GetId()
	workflowSlug := workflow.GetMetadata().GetName()
	ownerScope := workflow.GetMetadata().GetOwnerScope()

	log.Info().
		Str("workflow_id", workflowID).
		Str("slug", workflowSlug).
		Str("scope", ownerScope.String()).
		Msg("Creating default instance for workflow")

	// 1. Build default instance request
	defaultInstanceName := workflowSlug + "-default"

	metadataBuilder := &apiresource.ApiResourceMetadata{
		Name:       defaultInstanceName,
		OwnerScope: ownerScope,
	}

	// Copy org if org-scoped
	if ownerScope == apiresource.ApiResourceOwnerScope_organization {
		metadataBuilder.Org = workflow.GetMetadata().GetOrg()
	}

	instanceRequest := &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata:   metadataBuilder,
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId:  workflowID,
			Description: "Default instance (auto-created, no custom configuration)",
		},
	}

	// 2. Create instance via downstream client (in-process, system credentials)
	// This calls WorkflowInstanceCommandController.Create() in-process
	// All persistence and validation handled by instance handler
	createdInstance, err := s.workflowInstanceClient.CreateAsSystem(ctx.Context(), instanceRequest)
	if err != nil {
		return fmt.Errorf("failed to create default instance: %w", err)
	}

	defaultInstanceID := createdInstance.GetMetadata().GetId()
	log.Info().
		Str("instance_id", defaultInstanceID).
		Str("workflow_id", workflowID).
		Msg("Successfully created default instance for workflow")

	// 3. Store instance ID in context for next step
	ctx.Set(DefaultInstanceIDKey, defaultInstanceID)

	return nil
}

// updateWorkflowStatusWithDefaultInstanceStep updates workflow status with default instance ID.
//
// This step:
// 1. Reads default_instance_id from context (set by createDefaultInstanceStep)
// 2. Updates workflow status with default_instance_id
// 3. Persists updated workflow to repository
// 4. Updates context with persisted workflow for response
//
// Separated from createDefaultInstanceStep for pipeline clarity - makes it explicit
// that a database persist operation is happening.
type updateWorkflowStatusWithDefaultInstanceStep struct {
	store *badger.Store
}

func newUpdateWorkflowStatusWithDefaultInstanceStep(store *badger.Store) *updateWorkflowStatusWithDefaultInstanceStep {
	return &updateWorkflowStatusWithDefaultInstanceStep{store: store}
}

func (s *updateWorkflowStatusWithDefaultInstanceStep) Name() string {
	return "UpdateWorkflowStatusWithDefaultInstance"
}

func (s *updateWorkflowStatusWithDefaultInstanceStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	workflow := ctx.NewState()
	workflowID := workflow.GetMetadata().GetId()

	// 1. Read default instance ID from context
	defaultInstanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
	if !ok || defaultInstanceID == "" {
		log.Error().
			Str("workflow_id", workflowID).
			Msg("DEFAULT_INSTANCE_ID not found in context for workflow")
		return fmt.Errorf("default instance ID not found in context")
	}

	log.Info().
		Str("default_instance_id", defaultInstanceID).
		Str("workflow_id", workflowID).
		Msg("Updating workflow status with default_instance_id")

	// 2. Update workflow status with default_instance_id
	if workflow.Status == nil {
		workflow.Status = &workflowv1.WorkflowStatus{}
	}
	workflow.Status.DefaultInstanceId = defaultInstanceID

	// 3. Persist updated workflow to repository
	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
	if err := s.store.SaveResource(ctx.Context(), kind, workflowID, workflow); err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Failed to persist workflow with default_instance_id")
		return fmt.Errorf("failed to persist workflow with default instance: %w", err)
	}
	log.Debug().Str("workflow_id", workflowID).Msg("Persisted workflow with default_instance_id")

	// 4. Update context with persisted workflow for response
	ctx.SetNewState(workflow)

	log.Info().
		Str("default_instance_id", defaultInstanceID).
		Str("workflow_id", workflowID).
		Msg("Successfully updated workflow status with default_instance_id")

	return nil
}
