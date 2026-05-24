package workflowinstance

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing workflow instance.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
func (c *WorkflowInstanceController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	instance := reqCtx.Get(updateVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)
	return instance, nil
}

const updateVisibilityInstanceKey = "updateVisibilityInstance"

func (c *WorkflowInstanceController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("workflow-instance-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadInstanceForVisibilityUpdateStep()).
		AddStep(c.newSetInstanceVisibilityStep()).
		AddStep(c.newPersistInstanceForVisibilityUpdateStep()).
		AddStep(c.newIndexInstanceAfterVisibilityUpdateStep()).
		Build()
}

// loadInstanceForVisibilityUpdateStep loads the workflow instance by resource_id.
type loadInstanceForVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowInstanceController) newLoadInstanceForVisibilityUpdateStep() *loadInstanceForVisibilityUpdateStep {
	return &loadInstanceForVisibilityUpdateStep{store: c.store}
}

func (s *loadInstanceForVisibilityUpdateStep) Name() string {
	return "LoadInstanceForVisibilityUpdate"
}

func (s *loadInstanceForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	instance := &workflowinstancev1.WorkflowInstance{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, input.GetResourceId(), instance)
	if err != nil {
		return grpclib.NotFoundError("workflow instance", input.GetResourceId())
	}

	ctx.Set(updateVisibilityInstanceKey, instance)
	return nil
}

// setInstanceVisibilityStep sets metadata.visibility and updates audit fields.
type setInstanceVisibilityStep struct{}

func (c *WorkflowInstanceController) newSetInstanceVisibilityStep() *setInstanceVisibilityStep {
	return &setInstanceVisibilityStep{}
}

func (s *setInstanceVisibilityStep) Name() string {
	return "SetInstanceVisibility"
}

func (s *setInstanceVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	instance := ctx.Get(updateVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)

	instance.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(instance); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilityInstanceKey, instance)
	return nil
}

// persistInstanceForVisibilityUpdateStep saves the updated workflow instance.
type persistInstanceForVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowInstanceController) newPersistInstanceForVisibilityUpdateStep() *persistInstanceForVisibilityUpdateStep {
	return &persistInstanceForVisibilityUpdateStep{store: c.store}
}

func (s *persistInstanceForVisibilityUpdateStep) Name() string {
	return "PersistInstanceForVisibilityUpdate"
}

func (s *persistInstanceForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	instance := ctx.Get(updateVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, instance.GetMetadata().GetId(), instance)
	if err != nil {
		return grpclib.InternalError(err, "failed to save workflow instance")
	}

	return nil
}

// indexInstanceAfterVisibilityUpdateStep updates the search index.
type indexInstanceAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowInstanceController) newIndexInstanceAfterVisibilityUpdateStep() *indexInstanceAfterVisibilityUpdateStep {
	return &indexInstanceAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexInstanceAfterVisibilityUpdateStep) Name() string {
	return "IndexInstanceAfterVisibilityUpdate"
}

func (s *indexInstanceAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	instance := ctx.Get(updateVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)

	ext := &extractor.WorkflowInstanceExtractor{}
	entry := ext.GetSearchIndexEntry(instance)
	if entry == nil {
		log.Warn().Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, instance.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
