package memory

import (
	"context"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Reject moves a proposed memory to rejected. A rejected memory is never
// recalled; the record is kept rather than deleted so the decision is
// auditable and an identical re-proposal is visible as such (DD-005).
//
// Rejecting an already-rejected memory is an idempotent no-op. Rejecting
// a confirmed memory is refused with FAILED_PRECONDITION: deleting a
// confirmed memory IS its revocation (DD-006) — a reject that pretended
// to revoke would leave a misleading audit record.
//
// Rejection is deliberately one click on every surface — expensive
// review teaches users to ignore the proposal queue (DD-005 D4).
func (c *MemoryController) Reject(ctx context.Context, memoryId *memoryv1.MemoryId) (*memoryv1.Memory, error) {
	reqCtx := pipeline.NewRequestContext(ctx, memoryId)
	p := c.buildTransitionPipeline(
		"memory-reject",
		memoryv1.MemoryLifecycleState_lifecycle_state_rejected,
		MemoryRejectConfirmedMessage,
	)
	return c.runTransition(reqCtx, p)
}
