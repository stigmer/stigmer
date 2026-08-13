package agentinstance

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// UpdateVisibility updates the visibility of an existing agent instance.
//
// This is a targeted metadata update — it only modifies metadata.visibility,
// leaving spec, status, and other metadata fields untouched.
func (c *AgentInstanceController) UpdateVisibility(
	ctx context.Context,
	input *apiresourcepb.UpdateVisibilityInput,
) (*agentinstancev1.AgentInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildUpdateVisibilityPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	instance := reqCtx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)
	return instance, nil
}

const updateVisibilityInstanceKey = "updateVisibilityInstance"

func (c *AgentInstanceController) buildUpdateVisibilityPipeline() *pipeline.Pipeline[*apiresourcepb.UpdateVisibilityInput] {
	return pipeline.NewPipeline[*apiresourcepb.UpdateVisibilityInput]("agent-instance-update-visibility").
		AddStep(steps.NewValidateProtoStep[*apiresourcepb.UpdateVisibilityInput]()).
		AddStep(c.newLoadInstanceForVisibilityUpdateStep()).
		AddStep(c.newRejectDefaultInstanceVisibilityUpdateStep()). // Default instances first: FAILED_PRECONDITION wins over the level check, as in Cloud
		AddStep(steps.NewValidateVisibilityUpdateStep()).          // Reject unsupported levels (after load: NOT_FOUND wins, as in Cloud)
		AddStep(c.newSetInstanceVisibilityStep()).
		AddStep(c.newPersistInstanceForVisibilityUpdateStep()).
		AddStep(c.newIndexInstanceAfterVisibilityUpdateStep()).
		Build()
}

// rejectDefaultInstanceVisibilityUpdateStep rejects visibility updates on an
// agent's system-managed default instance — the OSS half of the guard the
// cloud edition applies in its ValidateVisibilityUpdateStep. Default
// instances carry no visibility of their own: their access always follows
// the parent agent, and a level stamped here would persist state the cloud
// edition considers structurally invalid (stigmer/stigmer#556).
//
// An instance counts as the default when EITHER holds:
//   - metadata carries the stigmer.ai/default-instance label (cloud's key —
//     stamped at create by defaultinstance.BuildRequest), or
//   - the parent agent's status.default_instance_id points at it (the
//     authoritative, server-owned record; covers instances created before
//     OSS stamped the label, and cannot be dropped by a client update the
//     way the label can — OSS has no reserved-label write guard).
//
// Deliberate divergence from cloud (label-only): the pointer branch makes
// the guard hold for pre-label legacy rows without a backfill migration.
// Deliberate non-goal: UpdateExecutionVisibility (spec.execution_visibility,
// run observability) is NOT guarded — cloud allows it on default instances
// (run-observability opt-in is independent of instance reachability, per
// DefaultAgentInstanceFactory). Do not "fix" that.
//
// A missing parent (orphan instance) passes through: nothing marks the
// instance default, and inventing a failure mode here would break the one
// legitimate operation an orphan supports. Any other store failure is
// INTERNAL — a transient fault must not silently open the guard.
type rejectDefaultInstanceVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentInstanceController) newRejectDefaultInstanceVisibilityUpdateStep() *rejectDefaultInstanceVisibilityUpdateStep {
	return &rejectDefaultInstanceVisibilityUpdateStep{store: c.store}
}

func (s *rejectDefaultInstanceVisibilityUpdateStep) Name() string {
	return "RejectDefaultInstanceVisibilityUpdate"
}

func (s *rejectDefaultInstanceVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	instance := ctx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)

	if apiresource.IsDefaultInstance(instance.GetMetadata()) {
		return steps.RejectDefaultInstanceVisibilityUpdate()
	}

	parentID := instance.GetSpec().GetAgentId()
	if parentID == "" {
		return nil
	}
	parent := &agentv1.Agent{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, parentID, parent); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return grpclib.InternalError(err, "failed to load parent agent for default-instance check")
	}
	if parent.GetStatus().GetDefaultInstanceId() == instance.GetMetadata().GetId() {
		return steps.RejectDefaultInstanceVisibilityUpdate()
	}
	return nil
}

// loadInstanceForVisibilityUpdateStep loads the agent instance by resource_id.
type loadInstanceForVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentInstanceController) newLoadInstanceForVisibilityUpdateStep() *loadInstanceForVisibilityUpdateStep {
	return &loadInstanceForVisibilityUpdateStep{store: c.store}
}

func (s *loadInstanceForVisibilityUpdateStep) Name() string {
	return "LoadInstanceForVisibilityUpdate"
}

func (s *loadInstanceForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()

	instance := &agentinstancev1.AgentInstance{}
	err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, input.GetResourceId(), instance)
	if err != nil {
		return grpclib.NotFoundError("agent instance", input.GetResourceId())
	}

	ctx.Set(updateVisibilityInstanceKey, instance)
	return nil
}

// setInstanceVisibilityStep sets metadata.visibility and updates audit fields.
type setInstanceVisibilityStep struct{}

func (c *AgentInstanceController) newSetInstanceVisibilityStep() *setInstanceVisibilityStep {
	return &setInstanceVisibilityStep{}
}

func (s *setInstanceVisibilityStep) Name() string {
	return "SetInstanceVisibility"
}

func (s *setInstanceVisibilityStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	input := ctx.Input()
	instance := ctx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)

	instance.Metadata.Visibility = input.GetVisibility()

	if err := steps.SetAuditFieldsForUpdate(instance); err != nil {
		return fmt.Errorf("failed to set audit fields: %w", err)
	}

	ctx.Set(updateVisibilityInstanceKey, instance)
	return nil
}

// persistInstanceForVisibilityUpdateStep saves the updated agent instance.
type persistInstanceForVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentInstanceController) newPersistInstanceForVisibilityUpdateStep() *persistInstanceForVisibilityUpdateStep {
	return &persistInstanceForVisibilityUpdateStep{store: c.store}
}

func (s *persistInstanceForVisibilityUpdateStep) Name() string {
	return "PersistInstanceForVisibilityUpdate"
}

func (s *persistInstanceForVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	instance := ctx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)

	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instance.GetMetadata().GetId(), instance)
	if err != nil {
		return grpclib.InternalError(err, "failed to save agent instance")
	}

	return nil
}

// indexInstanceAfterVisibilityUpdateStep updates the search index.
type indexInstanceAfterVisibilityUpdateStep struct {
	store store.Store
}

func (c *AgentInstanceController) newIndexInstanceAfterVisibilityUpdateStep() *indexInstanceAfterVisibilityUpdateStep {
	return &indexInstanceAfterVisibilityUpdateStep{store: c.store}
}

func (s *indexInstanceAfterVisibilityUpdateStep) Name() string {
	return "IndexInstanceAfterVisibilityUpdate"
}

func (s *indexInstanceAfterVisibilityUpdateStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.UpdateVisibilityInput]) error {
	instance := ctx.Get(updateVisibilityInstanceKey).(*agentinstancev1.AgentInstance)

	ext := &extractor.AgentInstanceExtractor{}
	entry := ext.GetSearchIndexEntry(instance)
	if entry == nil {
		log.Warn().Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterVisibilityUpdate: extractor returned nil, skipping")
		return nil
	}

	if err := s.store.UpsertSearchIndex(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance, instance.Metadata.Id, entry); err != nil {
		log.Warn().Err(err).Str("id", instance.Metadata.Id).Msg("IndexInstanceAfterVisibilityUpdate: failed (best-effort)")
	}

	return nil
}
