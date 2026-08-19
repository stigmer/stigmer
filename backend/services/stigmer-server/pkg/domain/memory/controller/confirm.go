package memory

import (
	"context"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Confirm moves a proposed memory to confirmed — the consent act
// (DD-005 D3). From the next eligible execution on, the fact is recalled
// as background context.
//
// Confirming an already-confirmed memory is an idempotent no-op.
// Confirming a rejected memory is refused with FAILED_PRECONDITION:
// the rejection stands as an auditable decision — delete the record and
// let the agent propose again.
//
// This RPC and reject are the ONLY writers of status.lifecycle_state.
// Consent is enforced here, at the control plane — never delegated to
// client-side approval mechanisms (DD-005 D3 records the three shipped
// HITL bypasses that make any client-side gate untrustworthy for
// retention).
func (c *MemoryController) Confirm(ctx context.Context, memoryId *memoryv1.MemoryId) (*memoryv1.Memory, error) {
	reqCtx := pipeline.NewRequestContext(ctx, memoryId)
	p := c.buildTransitionPipeline(
		"memory-confirm",
		memoryv1.MemoryLifecycleState_lifecycle_state_confirmed,
		MemoryConfirmRejectedMessage,
	)
	return c.runTransition(reqCtx, p)
}
