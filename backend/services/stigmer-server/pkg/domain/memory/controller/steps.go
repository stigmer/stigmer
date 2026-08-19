package memory

import (
	"errors"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// MaxMemoriesPerSubject is the per-subject-per-org record ceiling,
// counted across ALL lifecycle states — proposed clutter counts, which
// pressures honest rejection over letting proposals pile up (DD-006 D5).
const MaxMemoriesPerSubject = 100

// Cross-edition contract copy, byte-identical in the cloud edition's
// handlers and pinned by the conformance suite. Refusals are visible and
// actionable — never silent eviction (the ChatGPT Memory-Full pattern,
// DD-006 D5).
const (
	// MemoryFullMessage refuses a create once the subject's ceiling is
	// reached.
	MemoryFullMessage = "memory is full — review and delete existing memories"

	// MemoryDisabledMessageFmt refuses a create while the organization
	// has not enabled memory. Takes the org slug.
	MemoryDisabledMessageFmt = "memory is not enabled for organization %s — an organization admin can enable it in organization preferences"

	// MemoryConfirmRejectedMessage refuses confirming a rejected memory:
	// the decision is auditable and stands; a fresh proposal is the way
	// back.
	MemoryConfirmRejectedMessage = "memory was rejected — delete it and let the agent propose it again"

	// MemoryRejectConfirmedMessage refuses rejecting a confirmed memory:
	// deletion IS the revocation of a confirmed fact (DD-006).
	MemoryRejectConfirmedMessage = "memory was confirmed — delete it to stop it from being recalled"

	// MemorySubjectImmutableMessage refuses an update that changes the
	// subject: an editable subject would re-aim the record at another
	// person.
	MemorySubjectImmutableMessage = "spec.subject_identity_account_id is immutable — it is derived from the capturing credential at create"

	// MemoryProvenanceImmutableMessage refuses an update that changes
	// provenance: attribution that can be edited is not attribution.
	MemoryProvenanceImmutableMessage = "spec.provenance is immutable — it records where the fact came from"
)

// resolveMemoryDefaultsStep prepares a memory for creation — the server
// claiming every field it owns, before anything persists:
//
//  1. Requires metadata.org — memory records are org-scoped (DD-004), so
//     the org can never be inferred.
//  2. Mints metadata.id here (not in BuildNewState) when absent, so an
//     unnamed record can default its name/slug from its own identity:
//     memories are id-addressed records (the remember tool sends content
//     only), and the platform's slug machinery requires a name. A
//     client-supplied name still wins — the default only fills absence.
//  3. Overwrites spec.subject_identity_account_id with the empty-string
//     sentinel — the OSS single-user subject (the OAuth grant store
//     convention). Server-derived, never client-supplied (DD-005 D2):
//     the cloud edition writes the caller's identity account here.
//  4. Overwrites spec.provenance with what the server can derive from
//     the request context — nothing, for a direct RPC create (no session
//     in context), so the field is cleared. The field is server-owned;
//     a caller cannot dress up a record with forged attribution.
type resolveMemoryDefaultsStep struct{}

func (s *resolveMemoryDefaultsStep) Name() string {
	return "ResolveMemoryDefaults"
}

func (s *resolveMemoryDefaultsStep) Execute(ctx *pipeline.RequestContext[*memoryv1.Memory]) error {
	memory := ctx.NewState()
	metadata := memory.GetMetadata()

	if metadata.GetOrg() == "" {
		return grpclib.InvalidArgumentError("metadata.org is required for a memory")
	}

	if metadata.GetId() == "" {
		metadata.Id = steps.GenerateID("mem")
	}
	if metadata.GetName() == "" && metadata.GetSlug() == "" {
		metadata.Name = metadata.GetId()
	}

	// Server-owned identity fields (DD-005 D2). The OSS sentinel; the
	// cloud edition derives both from the calling credential/context.
	memory.Spec.SubjectIdentityAccountId = ""
	memory.Spec.Provenance = nil

	return nil
}

// checkMemoryEnablementStep enforces the org's memory_enabled switch at
// write time, FAIL-CLOSED (DD-005 D2): a write that cannot verify
// enablement refuses. This deliberately inverts the recall compose
// step's best-effort posture — an execution must start without its
// optional preferences, but a memory must never be stored without
// verified consent to store it.
//
// The runner-side remember-tool attachment is convenience, never
// authorization: "the label is not authorization; the server refuses"
// (the conversation-attachment doctrine, applied verbatim).
//
// OSS checks the org flag alone — the user scope collapses in
// single-user local mode (DD-006 D1). The cloud edition additionally
// requires the caller's own memory_enabled and the strict
// first-party-human gate.
type checkMemoryEnablementStep struct {
	store store.Store
}

func (s *checkMemoryEnablementStep) Name() string {
	return "CheckMemoryEnablement"
}

func (s *checkMemoryEnablementStep) Execute(ctx *pipeline.RequestContext[*memoryv1.Memory]) error {
	orgID := ctx.NewState().GetMetadata().GetOrg()

	org := &organizationv1.Organization{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_organization, orgID, org); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("Organization", orgID)
		}
		return grpclib.InternalError(err, "failed to load organization for memory enablement check")
	}

	if !org.GetSpec().GetPreferences().GetMemoryEnabled() {
		return grpclib.FailedPreconditionError(MemoryDisabledMessageFmt, orgID)
	}

	return nil
}

// checkMemoryCapStep enforces the per-subject-per-org record ceiling at
// create (DD-006 D5). Counted across all lifecycle states. A full-scan
// count matches the store's local/OSS posture at the kind's
// dozens-of-records scale (the schedule list precedent); the cloud
// edition counts through an indexed repository query.
type checkMemoryCapStep struct {
	store store.Store
}

func (s *checkMemoryCapStep) Name() string {
	return "CheckMemoryCap"
}

func (s *checkMemoryCapStep) Execute(ctx *pipeline.RequestContext[*memoryv1.Memory]) error {
	newState := ctx.NewState()
	org := newState.GetMetadata().GetOrg()
	subject := newState.GetSpec().GetSubjectIdentityAccountId()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_memory)
	if err != nil {
		return grpclib.InternalError(err, "failed to count memories for cap check")
	}

	count := 0
	for _, data := range resources {
		existing, ok := unmarshalMemory(data)
		if !ok {
			continue
		}
		if existing.GetMetadata().GetOrg() != org {
			continue
		}
		if existing.GetSpec().GetSubjectIdentityAccountId() != subject {
			continue
		}
		count++
	}

	if count >= MaxMemoriesPerSubject {
		return grpclib.FailedPreconditionError("%s", MemoryFullMessage)
	}

	return nil
}

// initializeMemoryLifecycleStep stamps the initial consent state after
// BuildNewState wiped client-provided status: every memory starts
// proposed (DD-005 D2) — nothing is recallable until the subject
// confirms. Runs after BuildNewState so the wipe cannot undo it and the
// audit block it set is preserved.
type initializeMemoryLifecycleStep struct{}

func (s *initializeMemoryLifecycleStep) Name() string {
	return "InitializeMemoryLifecycle"
}

func (s *initializeMemoryLifecycleStep) Execute(ctx *pipeline.RequestContext[*memoryv1.Memory]) error {
	memory := ctx.NewState()
	if memory.Status == nil {
		memory.Status = &memoryv1.MemoryStatus{}
	}
	memory.Status.LifecycleState = memoryv1.MemoryLifecycleState_lifecycle_state_proposed
	memory.Status.StateChangedAt = timestamppb.Now()
	return nil
}

// validateMemoryUpdateStep enforces the memory's immutable identity on
// update (the Schedule agent_ref pattern):
//
//   - spec.subject_identity_account_id must not change: an editable
//     subject would re-aim the record at another person, silently
//     defeating the subject-only visibility model.
//   - spec.provenance must not change, byte for byte: provenance is
//     attribution, displayed beside the fact everywhere — attribution
//     that can be edited is not attribution (DD-004).
//
// Update replaces the spec wholesale (declarative semantics), so callers
// carry the loaded values — the generated toMemoryUpdateInput mapper
// does this by construction. metadata.slug/org immutability needs no
// step here: the generic BuildUpdateState preserves both. The lifecycle
// state is protected by MECHANISM, not validation: persistMemoryUpdate
// grafts only metadata+spec+status.audit onto the live row (update.go).
//
// Runs after LoadExisting so the existing state is available.
type validateMemoryUpdateStep struct{}

func (s *validateMemoryUpdateStep) Name() string {
	return "ValidateMemoryUpdate"
}

func (s *validateMemoryUpdateStep) Execute(ctx *pipeline.RequestContext[*memoryv1.Memory]) error {
	existingVal := ctx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return grpclib.InternalError(nil, "existing memory not found in context")
	}
	existing := existingVal.(*memoryv1.Memory)
	newState := ctx.NewState()

	if newState.GetSpec().GetSubjectIdentityAccountId() != existing.GetSpec().GetSubjectIdentityAccountId() {
		return grpclib.FailedPreconditionError("%s", MemorySubjectImmutableMessage)
	}

	if !proto.Equal(newState.GetSpec().GetProvenance(), existing.GetSpec().GetProvenance()) {
		return grpclib.FailedPreconditionError("%s", MemoryProvenanceImmutableMessage)
	}

	return nil
}

// unmarshalMemory decodes a stored memory, skipping invalid entries
// (should not happen in normal operation).
func unmarshalMemory(data []byte) (*memoryv1.Memory, bool) {
	memory := &memoryv1.Memory{}
	if err := proto.Unmarshal(data, memory); err != nil {
		return nil, false
	}
	return memory, true
}
