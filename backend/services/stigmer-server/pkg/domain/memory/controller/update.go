package memory

import (
	"context"
	"errors"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// Update updates a memory's fact text (DD-004: the content is the
// subject's; everything else on the record is not up for editing).
//
// The spec is replaced wholesale (declarative semantics), but only
// content may actually change: subject and provenance are immutable
// (validate step), and the consent lifecycle is protected by MECHANISM —
// the persist grafts metadata+spec+status.audit onto the LIVE row inside
// one atomic read-modify-write, so status.lifecycle_state stays exactly
// as its owners (create, confirm, reject) last wrote it, even against a
// concurrent confirm landing between this pipeline's load and persist.
//
// Pipeline:
//  1. ValidateProto - Proto field constraints (content 1..500 chars)
//  2. LoadExisting - Load the existing memory by ID
//  3. ValidateMemoryUpdate - subject + provenance immutability
//  4. BuildUpdateState - Merge spec, preserve id/slug/org, stamp audit
//  5. PersistMemoryUpdate - Graft metadata+spec+status.audit onto the
//     live row (atomic; never touches the lifecycle leaves)
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
// requires can_edit on the memory — FGA subject-only).
func (c *MemoryController) Update(ctx context.Context, memory *memoryv1.Memory) (*memoryv1.Memory, error) {
	reqCtx := pipeline.NewRequestContext(ctx, memory)

	p := c.buildUpdatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *MemoryController) buildUpdatePipeline() *pipeline.Pipeline[*memoryv1.Memory] {
	return pipeline.NewPipeline[*memoryv1.Memory]("memory-update").
		AddStep(steps.NewValidateProtoStep[*memoryv1.Memory]()).
		AddStep(steps.NewLoadExistingStep[*memoryv1.Memory](c.store)).
		AddStep(&validateMemoryUpdateStep{}).
		AddStep(steps.NewBuildUpdateStateStep[*memoryv1.Memory]()).
		AddStep(&persistMemoryUpdateStep{store: c.store}).
		Build()
}

// persistMemoryUpdateStep persists an update as a graft of exactly what
// the request path owns — apiVersion/kind/metadata/spec plus the audit
// bump BuildUpdateState stamped — onto the LIVE row, inside one
// store.UpdateResource closure. NOT the generic PersistStep: memory
// status has other writers (confirm/reject), and a full-row save of the
// load-time snapshot could silently revert a consent decision made
// between this pipeline's load and its persist. The schedule domain's
// persistScheduleUpdateStep is the direct template (DD-015 D-C shape).
//
// The graft never resurrects a concurrently deleted row: UpdateResource
// answers not-found, relayed as NOT_FOUND — the delete won, honestly.
type persistMemoryUpdateStep struct {
	store store.Store
}

func (s *persistMemoryUpdateStep) Name() string {
	return "PersistMemoryUpdate"
}

func (s *persistMemoryUpdateStep) Execute(ctx *pipeline.RequestContext[*memoryv1.Memory]) error {
	newState := ctx.NewState()
	memoryID := newState.GetMetadata().GetId()

	live := &memoryv1.Memory{}
	err := s.store.UpdateResource(ctx.Context(), apiresourcekind.ApiResourceKind_memory,
		memoryID, live, func() error {
			live.ApiVersion = newState.GetApiVersion()
			live.Kind = newState.GetKind()
			live.Metadata = newState.GetMetadata()
			live.Spec = newState.GetSpec()
			// The one status subtree the request path owns: its own audit
			// bump. The lifecycle leaves stay exactly as their owners
			// (create/confirm/reject) last wrote them.
			if newState.GetStatus().GetAudit() != nil {
				if live.Status == nil {
					live.Status = &memoryv1.MemoryStatus{}
				}
				live.Status.Audit = newState.GetStatus().GetAudit()
			}
			return nil
		})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("Memory", memoryID)
		}
		return grpclib.InternalError(err, "failed to persist memory update")
	}

	// Answer with the persisted post-image: the new spec plus the LIVE
	// status — honest about any consent decision that landed mid-request.
	ctx.SetNewState(live)
	return nil
}
