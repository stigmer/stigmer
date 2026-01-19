package workflowinstance

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflow"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// Context keys for inter-step communication
const (
	ParentWorkflowKey = "parent_workflow"
)

// Create creates a new workflow instance using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. LoadParentWorkflow - Load and validate workflow template exists
// 3. ValidateSameOrgBusinessRule - Verify same-org for org-scoped instances
// 4. ResolveSlug - Generate slug from metadata.name
// 5. CheckDuplicate - Verify no duplicate exists
// 6. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 7. Persist - Save workflow instance to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
//
// Authorization model (from Java - informational only, not implemented in OSS):
// - Single check: can_create_instance on parent workflow (via spec.workflow_id)
// - For org-scoped: Uses contextual tuple workflow#organization@organization:target-org
// - FGA evaluates: "Can user create instance of this workflow in this org context?"
// - Validates user has access to all referenced environments
//
// Business rule validation:
// - Org workflows: Instance must be in same org or user-scoped (no cross-org instances)
func (c *WorkflowInstanceController) Create(ctx context.Context, instance *workflowinstancev1.WorkflowInstance) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for workflow instance creation
func (c *WorkflowInstanceController) buildCreatePipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstance] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstance]("workflow-instance-create").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstance]()).         // 1. Validate field constraints
		AddStep(newLoadParentWorkflowStep(c.workflowClient)).                                 // 2. Load parent workflow
		AddStep(newValidateSameOrgBusinessRuleStep()).                                        // 3. Validate same-org business rule
		AddStep(steps.NewResolveSlugStep[*workflowinstancev1.WorkflowInstance]()).           // 4. Resolve slug (CRITICAL: before checkDuplicate)
		AddStep(steps.NewCheckDuplicateStep[*workflowinstancev1.WorkflowInstance](c.store)). // 5. Check duplicate (needs resolved slug)
		AddStep(steps.NewBuildNewStateStep[*workflowinstancev1.WorkflowInstance]()).         // 6. Build new state
		AddStep(steps.NewPersistStep[*workflowinstancev1.WorkflowInstance](c.store)).        // 7. Persist workflow instance
		Build()
}

// ============================================================================
// Pipeline Steps (inline implementations following Java WorkflowInstanceCreateHandler pattern)
// ============================================================================

// loadParentWorkflowStep loads parent workflow and stores in context for subsequent steps.
//
// This step:
// 1. Reads workflow_id from instance spec
// 2. Loads the workflow from repository via workflow client
// 3. Stores it in context for use by business rule validation
//
// Corresponds to Java's LoadParentWorkflow step.
type loadParentWorkflowStep struct {
	workflowClient *workflow.Client
}

func newLoadParentWorkflowStep(workflowClient *workflow.Client) *loadParentWorkflowStep {
	return &loadParentWorkflowStep{workflowClient: workflowClient}
}

func (s *loadParentWorkflowStep) Name() string {
	return "LoadParentWorkflow"
}

func (s *loadParentWorkflowStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.WorkflowInstance]) error {
	requestedInstance := ctx.Input()
	workflowID := requestedInstance.GetSpec().GetWorkflowId()

	log.Info().
		Str("workflow_id", workflowID).
		Msg("Loading parent workflow")

	// Load workflow via downstream client
	parentWorkflow, err := s.workflowClient.Get(ctx.Context(), &workflowv1.WorkflowId{Value: workflowID})
	if err != nil {
		log.Warn().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Parent workflow not found")
		return grpclib.NotFoundError("Workflow", workflowID)
	}

	// Store in context for next step
	ctx.Set(ParentWorkflowKey, parentWorkflow)

	log.Debug().
		Str("workflow_id", workflowID).
		Str("scope", parentWorkflow.GetMetadata().GetOwnerScope().String()).
		Msg("Loaded parent workflow")

	return nil
}

// validateSameOrgBusinessRuleStep validates same-org business rule for org-scoped instances.
//
// Business rule: Org-scoped workflows can only create instances in the same organization.
// This prevents cross-org instance creation which could leak configuration/secrets.
//
// For platform or user-scoped instances, this validation is skipped.
//
// Corresponds to Java's ValidateSameOrgBusinessRule step.
type validateSameOrgBusinessRuleStep struct{}

func newValidateSameOrgBusinessRuleStep() *validateSameOrgBusinessRuleStep {
	return &validateSameOrgBusinessRuleStep{}
}

func (s *validateSameOrgBusinessRuleStep) Name() string {
	return "ValidateSameOrgBusinessRule"
}

func (s *validateSameOrgBusinessRuleStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.WorkflowInstance]) error {
	requestedInstance := ctx.NewState()
	
	// Get parent workflow from context
	parentWorkflowVal := ctx.Get(ParentWorkflowKey)
	if parentWorkflowVal == nil {
		return fmt.Errorf("parent workflow not found in context")
	}
	parentWorkflow := parentWorkflowVal.(*workflowv1.Workflow)

	targetScope := requestedInstance.GetMetadata().GetOwnerScope()
	workflowScope := parentWorkflow.GetMetadata().GetOwnerScope()

	// Only validate for org-scoped instances of org-scoped workflows
	if targetScope != apiresource.ApiResourceOwnerScope_organization ||
		workflowScope != apiresource.ApiResourceOwnerScope_organization {
		log.Debug().
			Str("target_scope", targetScope.String()).
			Str("workflow_scope", workflowScope.String()).
			Msg("Skipping same-org validation (not org-scoped)")
		return nil
	}

	targetOrgID := requestedInstance.GetMetadata().GetOrg()
	workflowOrgID := parentWorkflow.GetMetadata().GetOrg()
	workflowID := parentWorkflow.GetMetadata().GetId()

	log.Info().
		Str("workflow_org", workflowOrgID).
		Str("instance_org", targetOrgID).
		Msg("Validating same-org business rule")

	if workflowOrgID != targetOrgID {
		log.Warn().
			Str("workflow_id", workflowID).
			Str("workflow_org", workflowOrgID).
			Str("instance_org", targetOrgID).
			Msg("Business rule violation: Cannot create instance of org workflow in different org")
		return grpclib.InvalidArgumentError(
			fmt.Sprintf("Cannot create instance of org-scoped workflow in a different organization. "+
				"Workflow belongs to org '%s', instance target is org '%s'. "+
				"Create a user-scoped instance instead.", workflowOrgID, targetOrgID))
	}

	log.Debug().Msg("Same-org validation passed")
	return nil
}
