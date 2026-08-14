package workflow

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing workflow.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
func (c *WorkflowController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*workflowv1.Workflow, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	workflow := reqCtx.Get(updateVisibilityWorkflowKey).(*workflowv1.Workflow)
	return workflow, nil
}

const updateVisibilityWorkflowKey = "updateVisibilityWorkflow"

func (c *WorkflowController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("workflow-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadWorkflowForVisibilityUpdateStep()).
		AddStep(steps.NewValidateVisibilityUpdateStep()). // Reject unsupported levels (after load: NOT_FOUND wins, as in Cloud)
		AddStep(c.newSetWorkflowVisibilityStep()).
		AddStep(c.newPersistWorkflowForVisibilityUpdateStep()).
		AddStep(c.newIndexWorkflowAfterVisibilityUpdateStep()).
		Build()
}

// loadWorkflowForVisibilityUpdateStep loads the workflow by resource_id.
type loadWorkflowForVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowController) newLoadWorkflowForVisibilityUpdateStep() *loadWorkflowForVisibilityUpdateStep {
	return &loadWorkflowForVisibilityUpdateStep{store: c.store}
}

func (s *loadWorkflowForVisibilityUpdateStep) Name() string {
	return "LoadWorkflowForVisibilityUpdate"
}

func (s *loadWorkflowForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	workflow := &workflowv1.Workflow{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, input.GetResourceId(), workflow)
	if err != nil {
		return grpclib.NotFoundError("workflow", input.GetResourceId())
	}

	ctx.Set(updateVisibilityWorkflowKey, workflow)
	return nil
}

// setWorkflowVisibilityStep sets metadata.visibility and updates audit fields.
type setWorkflowVisibilityStep struct{}

func (c *WorkflowController) newSetWorkflowVisibilityStep() *setWorkflowVisibilityStep {
	return &setWorkflowVisibilityStep{}
}

func (s *setWorkflowVisibilityStep) Name() string {
	return "SetWorkflowVisibility"
}

func (s *setWorkflowVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	workflow := ctx.Get(updateVisibilityWorkflowKey).(*workflowv1.Workflow)

	workflow.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(workflow, steps.StatusAudit); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilityWorkflowKey, workflow)
	return nil
}

// persistWorkflowForVisibilityUpdateStep saves the updated workflow.
type persistWorkflowForVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowController) newPersistWorkflowForVisibilityUpdateStep() *persistWorkflowForVisibilityUpdateStep {
	return &persistWorkflowForVisibilityUpdateStep{store: c.store}
}

func (s *persistWorkflowForVisibilityUpdateStep) Name() string {
	return "PersistWorkflowForVisibilityUpdate"
}

func (s *persistWorkflowForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	workflow := ctx.Get(updateVisibilityWorkflowKey).(*workflowv1.Workflow)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflow.GetMetadata().GetId(), workflow)
	if err != nil {
		return grpclib.InternalError(err, "failed to save workflow")
	}

	return nil
}

// indexWorkflowAfterVisibilityUpdateStep updates the search index.
type indexWorkflowAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowController) newIndexWorkflowAfterVisibilityUpdateStep() *indexWorkflowAfterVisibilityUpdateStep {
	return &indexWorkflowAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexWorkflowAfterVisibilityUpdateStep) Name() string {
	return "IndexWorkflowAfterVisibilityUpdate"
}

func (s *indexWorkflowAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	workflow := ctx.Get(updateVisibilityWorkflowKey).(*workflowv1.Workflow)

	ext := &extractor.WorkflowExtractor{}
	entry := ext.GetSearchIndexEntry(workflow)
	if entry == nil {
		log.Warn().Str("id", workflow.Metadata.Id).Msg("IndexWorkflowAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflow.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", workflow.Metadata.Id).Msg("IndexWorkflowAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
