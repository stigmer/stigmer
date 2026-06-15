package workflow

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Context keys for inter-step communication
const (
	DefaultInstanceIDKey = "default_instance_id"
)

// Create creates a new workflow using the pipeline framework
//
// Pipeline (Stigmer OSS):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate (Layer 1)
// 2. ValidateWorkflowSpec - Validate workflow via Temporal (Layer 2: Go converts + validates - SSOT)
// 3. ResolveSlug - Generate slug from metadata.name
// 4. CheckDuplicate - Verify no duplicate exists
// 5. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 6. Persist - Save workflow to repository
// 7. CreateDefaultInstance - Create default workflow instance
// 8. UpdateWorkflowStatusWithDefaultInstance - Update workflow status with default_instance_id
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - PopulateServerlessValidation step (validation result not stored in workflow status yet)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *WorkflowController) Create(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflow)

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
		AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]()).                                      // 1. Validate field constraints (Layer 1)
		AddStep(newValidateWorkflowSpecStep(c.validator)).                                                // 2. In-process validation (proto → CNCF YAML + structural checks)
		AddStep(steps.NewResolveSlugStep[*workflowv1.Workflow]()).                                        // 3. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*workflowv1.Workflow](c.store)).                              // 4. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*workflowv1.Workflow]()).                                      // 5. Build new state
		AddStep(steps.NewNormalizeReferencesStep[*workflowv1.Workflow]()).                                // 6. Normalize cross-references
		AddStep(newPopulateServerlessValidationStep()).                                                   // 7. Populate serverless validation in workflow status
		AddStep(newComputeVersionHashStep()).                                                             // 8. Compute SHA-256 of CNCF YAML
		AddStep(newPopulateVersionHashStep(true)).                                                        // 9. Set status.version_hash + metadata.version chain
		AddStep(steps.NewPersistStep[*workflowv1.Workflow](c.store)).                                     // 10. Persist workflow (so default instance can reference it)
		AddStep(newCreateDefaultInstanceStep(c.workflowInstanceClient)).                                  // 11. Create default instance
		AddStep(newUpdateWorkflowStatusWithDefaultInstanceStep(c.store)).                                 // 12. Persist status.default_instance_id
		AddStep(newSaveVersionAuditStep(c.store, true, true)).                                            // 13. Archive v1 AFTER default_instance_id is set (re-persists on revert)
		AddStep(steps.NewIndexSearchStep[*workflowv1.Workflow](c.store, &extractor.WorkflowExtractor{})). // 14. Update search index
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
	workflowOrg := workflow.GetMetadata().GetOrg()

	log.Info().
		Str("workflow_id", workflowID).
		Str("slug", workflowSlug).
		Str("org", workflowOrg).
		Msg("Creating default instance for workflow")

	// 1. Build default instance request
	defaultInstanceName := workflowSlug + "-default"

	metadataBuilder := &apiresource.ApiResourceMetadata{
		Name: defaultInstanceName,
		Org:  workflowOrg, // All resources belong to an org
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
	store store.Store
}

func newUpdateWorkflowStatusWithDefaultInstanceStep(store store.Store) *updateWorkflowStatusWithDefaultInstanceStep {
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
