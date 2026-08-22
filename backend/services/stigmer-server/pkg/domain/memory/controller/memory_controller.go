// Package memory implements the Memory controllers — agent-proposed,
// user-confirmed facts the platform remembers about a person (decisions
// DD-004/DD-005/DD-006 of the preferences-and-memory project,
// stigmer/stigmer#293).
//
// A memory is system-generated: an agent proposes it (Phase 2 Stage 3's
// remember tool calls the create RPC), and it becomes recallable only
// after the person it is about confirms it. There is deliberately no
// apply RPC — nobody authors a memory manifest. The kind belongs to the
// Session/AgentExecution/Artifact family: records the platform creates
// that users inspect and manage.
//
// Field ownership (DD-004, provenance revised by the Stage 3 decision,
// owner-ratified 2026-08-22): spec.content is the subject's after
// capture (editable via update); spec.subject_identity_account_id is
// server-derived at create and immutable forever; spec.provenance is
// capture-path-supplied at create (the remember tool threads it; direct
// creates leave it empty; tool_call_id force-cleared in v1) and
// immutable forever after — attribution that can be edited is not
// attribution; status.lifecycle_state is written ONLY by create (initial
// proposed) and the confirm/reject commands. Updates graft
// metadata+spec+status.audit onto the live row and never touch the
// lifecycle — consent must not be rewritable through a spec edit.
//
// Consent posture (DD-005 D3): confirm/reject enforced at the control
// plane is the ENTIRE consent mechanism. Client-side approval flows are
// never trusted with retention — three shipped HITL bypasses are the
// recorded evidence (see DD-005).
//
// Caps (DD-006 D5): content length via protovalidate (500 chars); a
// 100-records-per-subject-per-org ceiling across ALL lifecycle states
// (proposed clutter counts, which pressures honest rejection), enforced
// at create with a visible FAILED_PRECONDITION — never silent eviction.
//
// Authorization posture (OSS): this edition is single-user and local, so
// handlers perform no authorization — a documented no-op, not a silent
// divergence. The subject is the empty-string sentinel (the OAuth grant
// store convention); enablement is the org flag alone (the user scope
// collapses — DD-002 D1). The cloud edition derives the subject from the
// calling credential, enforces the strict first-party-human gate, checks
// both memory_enabled flags, and gates every RPC through FGA
// (subject-only can_view/can_edit/can_delete).
package memory

import (
	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// MemoryController implements MemoryCommandController and
// MemoryQueryController.
type MemoryController struct {
	memoryv1.UnimplementedMemoryCommandControllerServer
	memoryv1.UnimplementedMemoryQueryControllerServer
	store store.Store
}

// NewMemoryController creates a new MemoryController.
func NewMemoryController(store store.Store) *MemoryController {
	return &MemoryController{store: store}
}
