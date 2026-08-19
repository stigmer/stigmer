package memory

import (
	"context"
	"fmt"
	"strings"
	"testing"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// memoryCtx simulates the apiresource interceptor, which injects the
// RPC's resource kind into the request context in production.
func memoryCtx() context.Context {
	return context.WithValue(context.Background(),
		apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_memory)
}

type testController struct {
	store      store.Store
	controller *MemoryController
}

func newTestController(t *testing.T) *testController {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return &testController{store: s, controller: NewMemoryController(s)}
}

// seedOrg writes an organization directly into the store (org id == slug
// in OSS), with the memory switch in the given position.
func seedOrg(t *testing.T, tc *testController, slug string, memoryEnabled bool) {
	t.Helper()
	org := &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Id: slug, Slug: slug, Name: slug},
		Spec: &organizationv1.OrganizationSpec{
			Preferences: &organizationv1.OrganizationPreferences{MemoryEnabled: memoryEnabled},
		},
	}
	if err := tc.store.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_organization, slug, org); err != nil {
		t.Fatalf("failed to seed org: %v", err)
	}
}

func memoryFor(org, content string) *memoryv1.Memory {
	return &memoryv1.Memory{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Memory",
		Metadata:   &apiresource.ApiResourceMetadata{Org: org},
		Spec:       &memoryv1.MemorySpec{Content: content},
	}
}

func createMemory(t *testing.T, tc *testController, org, content string) *memoryv1.Memory {
	t.Helper()
	created, err := tc.controller.Create(memoryCtx(), memoryFor(org, content))
	if err != nil {
		t.Fatalf("memory Create failed: %v", err)
	}
	return created
}

func requireStatus(t *testing.T, err error, want codes.Code, wantSubstring string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %v error containing %q, got nil", want, wantSubstring)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %v", err)
	}
	if st.Code() != want {
		t.Fatalf("expected code %v, got %v (%s)", want, st.Code(), st.Message())
	}
	if !strings.Contains(st.Message(), wantSubstring) {
		t.Fatalf("expected message containing %q, got %q", wantSubstring, st.Message())
	}
}

// --- Create ---

func TestMemoryCreate_ProposedWithServerOwnedFields(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)

	// The caller tries to smuggle a subject, provenance, and a decided
	// lifecycle — every server-owned field must come back server-written.
	request := memoryFor("test-org", "Prefers terse answers.")
	request.Spec.SubjectIdentityAccountId = "ida_forged"
	request.Spec.Provenance = &memoryv1.MemoryProvenance{AgentId: "agt_forged"}
	request.Status = &memoryv1.MemoryStatus{
		LifecycleState: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed,
	}

	created, err := tc.controller.Create(memoryCtx(), request)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if !strings.HasPrefix(created.GetMetadata().GetId(), "mem_") {
		t.Errorf("expected mem_ id prefix, got %q", created.GetMetadata().GetId())
	}
	if created.GetSpec().GetSubjectIdentityAccountId() != "" {
		t.Errorf("subject must be the OSS empty-string sentinel, got %q",
			created.GetSpec().GetSubjectIdentityAccountId())
	}
	if created.GetSpec().GetProvenance() != nil {
		t.Errorf("provenance must be server-cleared on a direct create, got %v",
			created.GetSpec().GetProvenance())
	}
	if created.GetStatus().GetLifecycleState() != memoryv1.MemoryLifecycleState_lifecycle_state_proposed {
		t.Errorf("every memory starts proposed, got %v", created.GetStatus().GetLifecycleState())
	}
	if created.GetStatus().GetStateChangedAt() == nil {
		t.Error("state_changed_at must be stamped at create")
	}
	if created.GetSpec().GetContent() != "Prefers terse answers." {
		t.Errorf("content must be stored verbatim, got %q", created.GetSpec().GetContent())
	}
	// Unnamed records default name/slug from their own identity.
	if created.GetMetadata().GetName() != created.GetMetadata().GetId() {
		t.Errorf("unnamed memory should default name from id, got name %q",
			created.GetMetadata().GetName())
	}
	if created.GetMetadata().GetSlug() == "" {
		t.Error("slug must be derived")
	}
}

func TestMemoryCreate_ClientNameWins(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)

	request := memoryFor("test-org", "Deploys to us-east-1.")
	request.Metadata.Name = "region preference"

	created := func() *memoryv1.Memory {
		m, err := tc.controller.Create(memoryCtx(), request)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		return m
	}()

	if created.GetMetadata().GetName() != "region preference" {
		t.Errorf("client-supplied name must win, got %q", created.GetMetadata().GetName())
	}
	if created.GetMetadata().GetSlug() != "region-preference" {
		t.Errorf("slug derives from the name, got %q", created.GetMetadata().GetSlug())
	}
}

func TestMemoryCreate_RequiresOrg(t *testing.T) {
	tc := newTestController(t)

	_, err := tc.controller.Create(memoryCtx(), memoryFor("", "A fact."))
	requireStatus(t, err, codes.InvalidArgument, "metadata.org is required")
}

func TestMemoryCreate_MissingOrgAnswersNotFound(t *testing.T) {
	tc := newTestController(t)

	_, err := tc.controller.Create(memoryCtx(), memoryFor("ghost-org", "A fact."))
	requireStatus(t, err, codes.NotFound, "ghost-org")
}

func TestMemoryCreate_DisabledOrgFailsClosed(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", false)

	_, err := tc.controller.Create(memoryCtx(), memoryFor("test-org", "A fact."))
	requireStatus(t, err, codes.FailedPrecondition,
		fmt.Sprintf(MemoryDisabledMessageFmt, "test-org"))
}

func TestMemoryCreate_ContentValidation(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)

	_, err := tc.controller.Create(memoryCtx(), memoryFor("test-org", ""))
	requireStatus(t, err, codes.InvalidArgument, "content")

	_, err = tc.controller.Create(memoryCtx(), memoryFor("test-org", strings.Repeat("x", 501)))
	requireStatus(t, err, codes.InvalidArgument, "content")

	// Exactly at the cap is fine — the limit is 500, not 499.
	if _, err := tc.controller.Create(memoryCtx(), memoryFor("test-org", strings.Repeat("x", 500))); err != nil {
		t.Fatalf("500-char content must be accepted: %v", err)
	}
}

func TestMemoryCreate_CapRefusesVisibly(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	seedOrg(t, tc, "other-org", true)

	for i := 0; i < MaxMemoriesPerSubject; i++ {
		createMemory(t, tc, "test-org", fmt.Sprintf("Fact number %d.", i))
	}

	_, err := tc.controller.Create(memoryCtx(), memoryFor("test-org", "One too many."))
	requireStatus(t, err, codes.FailedPrecondition, MemoryFullMessage)

	// The ceiling is per subject PER ORG — another org is unaffected.
	createMemory(t, tc, "other-org", "Fresh org, fresh ceiling.")
}

func TestMemoryCreate_RejectedRecordsCountTowardCap(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)

	for i := 0; i < MaxMemoriesPerSubject; i++ {
		created := createMemory(t, tc, "test-org", fmt.Sprintf("Fact number %d.", i))
		if _, err := tc.controller.Reject(memoryCtx(),
			&memoryv1.MemoryId{Value: created.GetMetadata().GetId()}); err != nil {
			t.Fatalf("Reject failed: %v", err)
		}
	}

	// All states count (DD-006 D5): rejected clutter fills the ceiling,
	// which pressures deletion over accumulation.
	_, err := tc.controller.Create(memoryCtx(), memoryFor("test-org", "One too many."))
	requireStatus(t, err, codes.FailedPrecondition, MemoryFullMessage)
}

// --- Confirm / Reject ---

func TestMemoryConfirm_ProposedBecomesConfirmed(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "A fact.")

	confirmed, err := tc.controller.Confirm(memoryCtx(),
		&memoryv1.MemoryId{Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Confirm failed: %v", err)
	}
	if confirmed.GetStatus().GetLifecycleState() != memoryv1.MemoryLifecycleState_lifecycle_state_confirmed {
		t.Fatalf("expected confirmed, got %v", confirmed.GetStatus().GetLifecycleState())
	}
	if confirmed.GetStatus().GetStateChangedAt().AsTime().Equal(created.GetStatus().GetStateChangedAt().AsTime()) {
		t.Error("state_changed_at must move with the decision")
	}
}

func TestMemoryConfirm_IsIdempotent(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "A fact.")
	id := &memoryv1.MemoryId{Value: created.GetMetadata().GetId()}

	first, err := tc.controller.Confirm(memoryCtx(), id)
	if err != nil {
		t.Fatalf("Confirm failed: %v", err)
	}
	second, err := tc.controller.Confirm(memoryCtx(), id)
	if err != nil {
		t.Fatalf("re-Confirm must be an idempotent no-op: %v", err)
	}
	// No write on the idempotent path: the decision timestamp holds.
	if !second.GetStatus().GetStateChangedAt().AsTime().Equal(first.GetStatus().GetStateChangedAt().AsTime()) {
		t.Error("idempotent re-confirm must not bump state_changed_at")
	}
}

func TestMemoryConfirm_RejectedIsRefused(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "A fact.")
	id := &memoryv1.MemoryId{Value: created.GetMetadata().GetId()}

	if _, err := tc.controller.Reject(memoryCtx(), id); err != nil {
		t.Fatalf("Reject failed: %v", err)
	}
	_, err := tc.controller.Confirm(memoryCtx(), id)
	requireStatus(t, err, codes.FailedPrecondition, MemoryConfirmRejectedMessage)
}

func TestMemoryReject_ConfirmedIsRefused(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "A fact.")
	id := &memoryv1.MemoryId{Value: created.GetMetadata().GetId()}

	if _, err := tc.controller.Confirm(memoryCtx(), id); err != nil {
		t.Fatalf("Confirm failed: %v", err)
	}
	_, err := tc.controller.Reject(memoryCtx(), id)
	requireStatus(t, err, codes.FailedPrecondition, MemoryRejectConfirmedMessage)
}

func TestMemoryReject_IsIdempotent(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "A fact.")
	id := &memoryv1.MemoryId{Value: created.GetMetadata().GetId()}

	if _, err := tc.controller.Reject(memoryCtx(), id); err != nil {
		t.Fatalf("Reject failed: %v", err)
	}
	rejected, err := tc.controller.Reject(memoryCtx(), id)
	if err != nil {
		t.Fatalf("re-Reject must be an idempotent no-op: %v", err)
	}
	if rejected.GetStatus().GetLifecycleState() != memoryv1.MemoryLifecycleState_lifecycle_state_rejected {
		t.Fatalf("expected rejected, got %v", rejected.GetStatus().GetLifecycleState())
	}
}

func TestMemoryCommands_MissingRecordAnswersNotFound(t *testing.T) {
	tc := newTestController(t)
	ghost := &memoryv1.MemoryId{Value: "mem_ghost"}

	_, err := tc.controller.Confirm(memoryCtx(), ghost)
	requireStatus(t, err, codes.NotFound, "mem_ghost")

	_, err = tc.controller.Reject(memoryCtx(), ghost)
	requireStatus(t, err, codes.NotFound, "mem_ghost")

	_, err = tc.controller.Delete(memoryCtx(), ghost)
	requireStatus(t, err, codes.NotFound, "mem_ghost")

	_, err = tc.controller.Get(memoryCtx(), ghost)
	requireStatus(t, err, codes.NotFound, "mem_ghost")
}

// --- Update ---

func TestMemoryUpdate_EditsContentAndPreservesLifecycle(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "Prefers terse answers.")
	id := &memoryv1.MemoryId{Value: created.GetMetadata().GetId()}

	if _, err := tc.controller.Confirm(memoryCtx(), id); err != nil {
		t.Fatalf("Confirm failed: %v", err)
	}

	// The update carries a wiped status (as the generated mappers do) —
	// the lifecycle must survive by mechanism, not luck.
	edited := &memoryv1.Memory{
		ApiVersion: created.GetApiVersion(),
		Kind:       created.GetKind(),
		Metadata:   created.GetMetadata(),
		Spec: &memoryv1.MemorySpec{
			Content:                  "Prefers terse answers with code examples.",
			SubjectIdentityAccountId: created.GetSpec().GetSubjectIdentityAccountId(),
			Provenance:               created.GetSpec().GetProvenance(),
		},
	}

	updated, err := tc.controller.Update(memoryCtx(), edited)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if updated.GetSpec().GetContent() != "Prefers terse answers with code examples." {
		t.Errorf("content edit lost: %q", updated.GetSpec().GetContent())
	}
	if updated.GetStatus().GetLifecycleState() != memoryv1.MemoryLifecycleState_lifecycle_state_confirmed {
		t.Errorf("update must never touch the consent lifecycle, got %v",
			updated.GetStatus().GetLifecycleState())
	}
}

func TestMemoryUpdate_SubjectIsImmutable(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "A fact.")

	edited := &memoryv1.Memory{
		ApiVersion: created.GetApiVersion(),
		Kind:       created.GetKind(),
		Metadata:   created.GetMetadata(),
		Spec: &memoryv1.MemorySpec{
			Content:                  "A fact.",
			SubjectIdentityAccountId: "ida_someone_else",
		},
	}

	_, err := tc.controller.Update(memoryCtx(), edited)
	requireStatus(t, err, codes.FailedPrecondition, MemorySubjectImmutableMessage)
}

func TestMemoryUpdate_ProvenanceIsImmutable(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	created := createMemory(t, tc, "test-org", "A fact.")

	edited := &memoryv1.Memory{
		ApiVersion: created.GetApiVersion(),
		Kind:       created.GetKind(),
		Metadata:   created.GetMetadata(),
		Spec: &memoryv1.MemorySpec{
			Content:    "A fact.",
			Provenance: &memoryv1.MemoryProvenance{AgentId: "agt_invented"},
		},
	}

	_, err := tc.controller.Update(memoryCtx(), edited)
	requireStatus(t, err, codes.FailedPrecondition, MemoryProvenanceImmutableMessage)
}

// --- Delete ---

func TestMemoryDelete_AnyLifecycleState(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)

	// Proposed, confirmed, and rejected records must all delete — the
	// any-state guarantee is the trust story (DD-004).
	proposed := createMemory(t, tc, "test-org", "Proposed fact.")

	confirmed := createMemory(t, tc, "test-org", "Confirmed fact.")
	if _, err := tc.controller.Confirm(memoryCtx(),
		&memoryv1.MemoryId{Value: confirmed.GetMetadata().GetId()}); err != nil {
		t.Fatalf("Confirm failed: %v", err)
	}

	rejected := createMemory(t, tc, "test-org", "Rejected fact.")
	if _, err := tc.controller.Reject(memoryCtx(),
		&memoryv1.MemoryId{Value: rejected.GetMetadata().GetId()}); err != nil {
		t.Fatalf("Reject failed: %v", err)
	}

	for _, record := range []*memoryv1.Memory{proposed, confirmed, rejected} {
		id := &memoryv1.MemoryId{Value: record.GetMetadata().GetId()}
		deleted, err := tc.controller.Delete(memoryCtx(), id)
		if err != nil {
			t.Fatalf("Delete failed for %s: %v", record.GetMetadata().GetId(), err)
		}
		if deleted.GetMetadata().GetId() != record.GetMetadata().GetId() {
			t.Errorf("delete must return the deleted record")
		}
		_, err = tc.controller.Get(memoryCtx(), id)
		requireStatus(t, err, codes.NotFound, record.GetMetadata().GetId())
	}
}

// --- Get / List ---

func TestMemoryGetAndList(t *testing.T) {
	tc := newTestController(t)
	seedOrg(t, tc, "test-org", true)
	seedOrg(t, tc, "other-org", true)

	first := createMemory(t, tc, "test-org", "First fact.")
	second := createMemory(t, tc, "test-org", "Second fact.")
	createMemory(t, tc, "other-org", "Another org's fact.")

	got, err := tc.controller.Get(memoryCtx(), &memoryv1.MemoryId{Value: first.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.GetSpec().GetContent() != "First fact." {
		t.Errorf("Get returned wrong record: %q", got.GetSpec().GetContent())
	}

	list, err := tc.controller.List(memoryCtx(), &memoryv1.ListMemoriesRequest{Org: "test-org"})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if list.GetTotalCount() != 2 || len(list.GetItems()) != 2 {
		t.Fatalf("expected 2 memories in test-org, got %d", list.GetTotalCount())
	}
	// Newest first.
	if list.GetItems()[0].GetMetadata().GetId() != second.GetMetadata().GetId() {
		t.Errorf("expected newest-first ordering")
	}
	for _, item := range list.GetItems() {
		if item.GetMetadata().GetOrg() != "test-org" {
			t.Errorf("list leaked a record from %q", item.GetMetadata().GetOrg())
		}
	}

	_, err = tc.controller.List(memoryCtx(), &memoryv1.ListMemoriesRequest{})
	requireStatus(t, err, codes.InvalidArgument, "org")
}
