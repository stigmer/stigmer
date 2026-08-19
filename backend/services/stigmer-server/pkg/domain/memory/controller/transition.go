package memory

import (
	"errors"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// errTransitionNoOp aborts the atomic write on the idempotent path — the
// record is already in the target state, so nothing is written and no
// audit bumps.
var errTransitionNoOp = errors.New("memory already in target state")

// transitionMemoryLifecycleStep moves a memory's consent lifecycle to a
// target decided state in ONE store.UpdateResource closure on the
// freshly-read row — confirm and reject share this step because they are
// one contract with opposite verdicts (DD-005 D3).
//
// Transition matrix (see MemoryLifecycleState's doc):
//   - proposed (or unspecified, defensively) → target: written, with
//     state_changed_at and a StatusAudit bump.
//   - already the target → idempotent success, no write, no audit bump.
//   - the OPPOSITE decided state → FAILED_PRECONDITION with the
//     cross-edition copy: decisions do not flip — deletion is the way
//     out of confirmed (revocation) and out of rejected (making room for
//     a fresh proposal).
//
// The atomic closure is adopted from schedule's clearSchedulePauseStep:
// memory has no concurrent status writer yet in Stage 1, but Stage 2's
// recall reads and any future writer get the discipline for free, and a
// concurrent delete is already answered honestly (NOT_FOUND — the
// delete won).
type transitionMemoryLifecycleStep struct {
	store store.Store

	// target is the decided state this command writes.
	target memoryv1.MemoryLifecycleState
	// blockedMessage refuses the transition from the opposite decided
	// state — one of the byte-pinned contract constants in steps.go.
	blockedMessage string
}

func (s *transitionMemoryLifecycleStep) Name() string {
	return "TransitionMemoryLifecycle"
}

func (s *transitionMemoryLifecycleStep) Execute(ctx *pipeline.RequestContext[*memoryv1.MemoryId]) error {
	loaded := ctx.Get(steps.ExistingResourceKey).(*memoryv1.Memory)
	memoryID := loaded.GetMetadata().GetId()

	var blocked error
	live := &memoryv1.Memory{}
	err := s.store.UpdateResource(ctx.Context(), apiresourcekind.ApiResourceKind_memory,
		memoryID, live, func() error {
			current := live.GetStatus().GetLifecycleState()
			if current == s.target {
				return errTransitionNoOp
			}
			if current != memoryv1.MemoryLifecycleState_lifecycle_state_proposed &&
				current != memoryv1.MemoryLifecycleState_lifecycle_state_unspecified {
				// The opposite decided state: refuse without writing.
				blocked = grpclib.FailedPreconditionError("%s", s.blockedMessage)
				return blocked
			}
			if live.Status == nil {
				live.Status = &memoryv1.MemoryStatus{}
			}
			live.Status.LifecycleState = s.target
			live.Status.StateChangedAt = timestamppb.Now()
			if auditErr := steps.SetAuditFieldsForUpdate(live, steps.StatusAudit); auditErr != nil {
				return auditErr
			}
			return nil
		})
	switch {
	case err == nil, errors.Is(err, errTransitionNoOp):
		// live holds the post-image (transitioned, or the untouched row
		// on the idempotent path) — the honest response either way.
		ctx.Set(steps.ExistingResourceKey, live)
		return nil
	case blocked != nil && errors.Is(err, blocked):
		return blocked
	case errors.Is(err, store.ErrNotFound):
		// Deleted between load and transition: the delete won.
		return grpclib.NotFoundError("Memory", memoryID)
	default:
		return grpclib.InternalError(err, "failed to transition memory lifecycle")
	}
}

// buildTransitionPipeline assembles the shared confirm/reject pipeline.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from MemoryId.Value wrapper
//  3. LoadExistingForDelete - Load the memory (NOT_FOUND if missing)
//  4. TransitionMemoryLifecycle - The atomic decided-state write
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
// requires can_edit on the memory — FGA subject-only, loading before
// authorizing so a missing memory answers NOT_FOUND, #224).
func (c *MemoryController) buildTransitionPipeline(
	name string,
	target memoryv1.MemoryLifecycleState,
	blockedMessage string,
) *pipeline.Pipeline[*memoryv1.MemoryId] {
	return pipeline.NewPipeline[*memoryv1.MemoryId](name).
		AddStep(steps.NewValidateProtoStep[*memoryv1.MemoryId]()).
		AddStep(steps.NewExtractResourceIdStep[*memoryv1.MemoryId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*memoryv1.MemoryId, *memoryv1.Memory](c.store)).
		AddStep(&transitionMemoryLifecycleStep{store: c.store, target: target, blockedMessage: blockedMessage}).
		Build()
}

// runTransition executes a confirm/reject pipeline and answers with the
// post-image row.
func (c *MemoryController) runTransition(
	reqCtx *pipeline.RequestContext[*memoryv1.MemoryId],
	p *pipeline.Pipeline[*memoryv1.MemoryId],
) (*memoryv1.Memory, error) {
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	transitioned := reqCtx.Get(steps.ExistingResourceKey)
	if transitioned == nil {
		return nil, grpclib.InternalError(nil, "transitioned memory not found in context")
	}

	return transitioned.(*memoryv1.Memory), nil
}
