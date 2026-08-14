package workflowinstance

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateExecutionVisibility updates who can observe the run history of a
// workflow instance.
//
// This is a targeted spec update — it only modifies spec.execution_visibility.
// In the OSS edition there is a single local user and no fine-grained
// authorization engine, so run observability has no multi-user effect: the
// setting is persisted faithfully (so the shared web/desktop UI can read it
// back), but no authorization tuples are written. The Cloud edition reconciles
// the instance's execution_viewer FGA relation.
func (c *WorkflowInstanceController) UpdateExecutionVisibility(
	ctx context.Context,
	input *workflowinstancev1.UpdateExecutionVisibilityInput,
) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateExecutionVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	instance := reqCtx.Get(updateExecutionVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)
	return instance, nil
}

const updateExecutionVisibilityInstanceKey = "updateExecutionVisibilityInstance"

func (c *WorkflowInstanceController) buildUpdateExecutionVisibilityPipeline() *pipeline.Pipeline[*workflowinstancev1.UpdateExecutionVisibilityInput] {
	return pipeline.NewPipeline[*workflowinstancev1.UpdateExecutionVisibilityInput]("workflow-instance-update-execution-visibility").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.UpdateExecutionVisibilityInput]()).
		AddStep(c.newLoadInstanceForExecutionVisibilityUpdateStep()).
		AddStep(c.newSetInstanceExecutionVisibilityStep()).
		AddStep(c.newPersistInstanceForExecutionVisibilityUpdateStep()).
		AddStep(c.newIndexInstanceAfterExecutionVisibilityUpdateStep()).
		Build()
}

// loadInstanceForExecutionVisibilityUpdateStep loads the instance by resource_id.
type loadInstanceForExecutionVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowInstanceController) newLoadInstanceForExecutionVisibilityUpdateStep() *loadInstanceForExecutionVisibilityUpdateStep {
	return &loadInstanceForExecutionVisibilityUpdateStep{store: c.store}
}

func (s *loadInstanceForExecutionVisibilityUpdateStep) Name() string {
	return "LoadInstanceForExecutionVisibilityUpdate"
}

func (s *loadInstanceForExecutionVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.UpdateExecutionVisibilityInput]) error {
	input := ctx.Input()

	instance := &workflowinstancev1.WorkflowInstance{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, input.GetResourceId(), instance)
	if err != nil {
		return grpclib.NotFoundError("workflow instance", input.GetResourceId())
	}

	ctx.Set(updateExecutionVisibilityInstanceKey, instance)
	return nil
}

// setInstanceExecutionVisibilityStep sets spec.execution_visibility and audit fields.
type setInstanceExecutionVisibilityStep struct{}

func (c *WorkflowInstanceController) newSetInstanceExecutionVisibilityStep() *setInstanceExecutionVisibilityStep {
	return &setInstanceExecutionVisibilityStep{}
}

func (s *setInstanceExecutionVisibilityStep) Name() string {
	return "SetInstanceExecutionVisibility"
}

func (s *setInstanceExecutionVisibilityStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.UpdateExecutionVisibilityInput]) error {
	input := ctx.Input()
	instance := ctx.Get(updateExecutionVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)

	if instance.Spec == nil {
		instance.Spec = &workflowinstancev1.WorkflowInstanceSpec{}
	}
	instance.Spec.ExecutionVisibility = input.GetExecutionVisibility()

	if err := steps.SetAuditFieldsForUpdate(instance, steps.StatusAudit); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateExecutionVisibilityInstanceKey, instance)
	return nil
}

// persistInstanceForExecutionVisibilityUpdateStep saves the updated instance.
type persistInstanceForExecutionVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowInstanceController) newPersistInstanceForExecutionVisibilityUpdateStep() *persistInstanceForExecutionVisibilityUpdateStep {
	return &persistInstanceForExecutionVisibilityUpdateStep{store: c.store}
}

func (s *persistInstanceForExecutionVisibilityUpdateStep) Name() string {
	return "PersistInstanceForExecutionVisibilityUpdate"
}

func (s *persistInstanceForExecutionVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.UpdateExecutionVisibilityInput]) error {
	instance := ctx.Get(updateExecutionVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, instance.GetMetadata().GetId(), instance)
	if err != nil {
		return grpclib.InternalError(err, "failed to save workflow instance")
	}

	return nil
}

// indexInstanceAfterExecutionVisibilityUpdateStep updates the search index.
type indexInstanceAfterExecutionVisibilityUpdateStep struct {
	store store.Store
}

func (c *WorkflowInstanceController) newIndexInstanceAfterExecutionVisibilityUpdateStep() *indexInstanceAfterExecutionVisibilityUpdateStep {
	return &indexInstanceAfterExecutionVisibilityUpdateStep{store: c.store}
}

func (s *indexInstanceAfterExecutionVisibilityUpdateStep) Name() string {
	return "IndexInstanceAfterExecutionVisibilityUpdate"
}

func (s *indexInstanceAfterExecutionVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.UpdateExecutionVisibilityInput]) error {
	instance := ctx.Get(updateExecutionVisibilityInstanceKey).(*workflowinstancev1.WorkflowInstance)

	ext := &extractor.WorkflowInstanceExtractor{}
	entry := ext.GetSearchIndexEntry(instance)
	if entry == nil {
		log.Warn().Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterExecutionVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_instance, instance.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterExecutionVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
