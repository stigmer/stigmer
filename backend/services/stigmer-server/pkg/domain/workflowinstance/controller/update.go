package workflowinstance

import (
	"context"

	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Update updates an existing workflow instance using the pipeline framework
//
// Pipeline (Stigmer OSS):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadExisting - Load existing workflow instance from repository to verify it exists
// 4. ValidateInstanceUpdate - spec.workflow_id is immutable
// 5. BuildUpdateState - Merge spec, preserve IDs and status, update audit timestamps
// 6. Persist - Save updated workflow instance to repository
func (c *WorkflowInstanceController) Update(ctx context.Context, instance *workflowinstancev1.WorkflowInstance) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, instance)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for workflow instance update
func (c *WorkflowInstanceController) buildUpdatePipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstance] {
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstance]("workflow-instance-update").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstance]()).                                              // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*workflowinstancev1.WorkflowInstance]()).                                                // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*workflowinstancev1.WorkflowInstance](c.store)).                                        // 3. Load existing instance
		AddStep(&validateInstanceUpdateStep{}).                                                                                   // 4. spec.workflow_id is immutable
		AddStep(steps.NewBuildUpdateStateStep[*workflowinstancev1.WorkflowInstance]()).                                           // 5. Build updated state (merge spec, preserve status, update audit)
		AddStep(steps.NewNormalizeReferencesStep[*workflowinstancev1.WorkflowInstance]()).                                        // 6. Normalize cross-references
		AddStep(steps.NewPersistStep[*workflowinstancev1.WorkflowInstance](c.store)).                                             // 7. Persist workflow instance
		AddStep(steps.NewIndexSearchStep[*workflowinstancev1.WorkflowInstance](c.store, &extractor.WorkflowInstanceExtractor{})). // 8. Update search index
		Build()
}

// validateInstanceUpdateStep enforces the instance's immutable identity on
// update: spec.workflow_id must keep referencing the same workflow — the
// contract command.proto documents ("Immutable fields (must delete and
// recreate to change)"). An instance is a configured materialization OF one
// workflow — repointing it would silently change what its executions run
// while keeping the instance's identity, history, and references intact;
// create a new instance instead (oss#646).
//
// Rejecting (rather than silently preserving, as BuildUpdateState does for
// metadata.visibility) is deliberate: visibility has a legitimate second
// door — the guarded updateVisibility RPC — so stale manifests carrying an
// old level are routine and must not fail the update. The parent ref has NO
// other door; no manifest with a different workflow_id was ever valid, so a
// differing value is always a client error and deserves a loud failure.
// Same posture as the AgentChannel and Schedule update guards, and as the
// cloud edition's twin step.
//
// Runs after LoadExisting so the existing state is available. Apply
// delegates to Update for existing resources, so this guard covers the
// apply door too. An EMPTY request workflow_id never reaches this step —
// buf validate pins min_len=1, so ValidateProto rejects it first.
type validateInstanceUpdateStep struct{}

func (s *validateInstanceUpdateStep) Name() string {
	return "ValidateInstanceUpdate"
}

func (s *validateInstanceUpdateStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.WorkflowInstance]) error {
	existingVal := ctx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return grpclib.InternalError(nil, "existing workflow instance not found in context")
	}
	existing := existingVal.(*workflowinstancev1.WorkflowInstance)

	if ctx.Input().GetSpec().GetWorkflowId() != existing.GetSpec().GetWorkflowId() {
		return grpclib.FailedPreconditionError(
			"spec.workflow_id is immutable (instance runs workflow %s) — create a new instance to run a different workflow",
			existing.GetSpec().GetWorkflowId(),
		)
	}

	return nil
}
