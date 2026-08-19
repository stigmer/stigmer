//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

// The exact contract strings shared with the OSS Go edition (the
// backend-engineer rule: same error contracts in both editions). Sourced
// from MemoryPolicy (stigmer-cloud) and pkg/domain/memory/controller/steps.go
// (stigmer); the conformance suite pins them over the wire on OSS, this
// suite pins them on cloud. A change on either side must change all three.
const (
	memoryFullMessage            = "memory is full — review and delete existing memories"
	memoryDisabledMessageFmt     = "memory is not enabled for organization %s — an organization admin can enable it in organization preferences"
	memoryAccountDisabledMessage = "memory is not enabled for your account — enable it in account preferences"
	memoryCaptureCallerMessage   = "memory can only be captured for a first-party human operator"
	memoryConfirmRejectedMessage = "memory was rejected — delete it and let the agent propose it again"
	memoryRejectConfirmedMessage = "memory was confirmed — delete it to stop it from being recalled"
	memorySubjectImmutableMsg    = "spec.subject_identity_account_id is immutable — it is derived from the capturing credential at create"
)

func requireMemoryClients(t *testing.T) *harness.Clients {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	return harness.NewClients(grpcConn)
}

// createMemoryOrg provisions a fresh org with the memory switch in the
// requested position, so enablement is under each test's control and
// nothing bleeds through the suite's shared test-org.
func createMemoryOrg(t *testing.T, ctx context.Context, clients *harness.Clients, memoryEnabled bool) string {
	t.Helper()
	org, err := clients.OrganizationCommand.Create(ctx, &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "mem-org-" + uuid.New().String()[:8]},
		Spec: &organizationv1.OrganizationSpec{
			Preferences: &organizationv1.OrganizationPreferences{MemoryEnabled: memoryEnabled},
		},
	})
	require.NoError(t, err, "create memory test org")
	orgID := org.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, _ = clients.OrganizationCommand.Delete(cleanupCtx, &organizationv1.OrganizationId{Value: orgID})
	})
	return org.GetMetadata().GetSlug()
}

// enableAccountMemory flips the caller's own memory opt-in for the test
// and restores the original preferences afterward — account preferences
// are shared caller state on the suite's single test identity.
func enableAccountMemory(t *testing.T, ctx context.Context, clients *harness.Clients) *identityaccountv1.IdentityAccount {
	t.Helper()
	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "whoAmI should return the caller's account")

	original := proto.Clone(account).(*identityaccountv1.IdentityAccount)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, restoreErr := clients.IdentityAccountCommand.Update(cleanupCtx, original)
		assert.NoError(t, restoreErr, "restoring the original account preferences should succeed")
	})

	edited := proto.Clone(account).(*identityaccountv1.IdentityAccount)
	if edited.Spec == nil {
		edited.Spec = &identityaccountv1.IdentityAccountSpec{}
	}
	if edited.Spec.Preferences == nil {
		edited.Spec.Preferences = &identityaccountv1.IdentityAccountPreferences{}
	}
	edited.Spec.Preferences.MemoryEnabled = true
	updated, err := clients.IdentityAccountCommand.Update(ctx, edited)
	require.NoError(t, err, "enabling the account memory opt-in should succeed")
	require.True(t, updated.GetSpec().GetPreferences().GetMemoryEnabled())
	return account
}

func newMemory(org, content string) *memoryv1.Memory {
	return &memoryv1.Memory{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Memory",
		Metadata:   &apiresource.ApiResourceMetadata{Org: org},
		Spec:       &memoryv1.MemorySpec{Content: content},
	}
}

func requireGrpcError(t *testing.T, err error, code codes.Code, contains string) {
	t.Helper()
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok, "expected a gRPC status error, got %v", err)
	require.Equal(t, code, st.Code(), "unexpected code (message: %s)", st.Message())
	if contains != "" {
		require.Contains(t, st.Message(), contains)
	}
}

// TestMemory_CaptureAndConsentLifecycle exercises the full Stage 1 arc
// against the real service: double-opt-in create with server-derived
// subject, the consent matrix (confirm/reject, idempotency, no
// cross-decision), subject-owned content editing with identity locked,
// any-state delete, and the org-scoped list.
func TestMemory_CaptureAndConsentLifecycle(t *testing.T) {
	clients := requireMemoryClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	account := enableAccountMemory(t, ctx, clients)
	org := createMemoryOrg(t, ctx, clients, true)

	// --- create: proposed, subject derived from the credential ---
	forged := newMemory(org, "Prefers terse answers.")
	forged.Spec.SubjectIdentityAccountId = "ida_forged"
	forged.Spec.Provenance = &memoryv1.MemoryProvenance{AgentId: "agt_forged"}
	forged.Status = &memoryv1.MemoryStatus{
		LifecycleState: memoryv1.MemoryLifecycleState_lifecycle_state_confirmed,
	}

	created, err := clients.MemoryCommand.Create(ctx, forged)
	require.NoError(t, err, "memory create should succeed with both opt-ins on")
	assert.Regexp(t, "^mem_", created.GetMetadata().GetId())
	assert.Equal(t, account.GetMetadata().GetId(), created.GetSpec().GetSubjectIdentityAccountId(),
		"the subject must be the CALLER's identity account — never the request's")
	assert.Nil(t, created.GetSpec().GetProvenance(),
		"provenance must be server-claimed (empty for a direct create)")
	assert.Equal(t, memoryv1.MemoryLifecycleState_lifecycle_state_proposed,
		created.GetStatus().GetLifecycleState(), "every memory starts proposed")
	memoryID := &memoryv1.MemoryId{Value: created.GetMetadata().GetId()}

	// --- confirm: the consent act, idempotent, never flipping ---
	confirmed, err := clients.MemoryCommand.Confirm(ctx, memoryID)
	require.NoError(t, err)
	assert.Equal(t, memoryv1.MemoryLifecycleState_lifecycle_state_confirmed,
		confirmed.GetStatus().GetLifecycleState())

	again, err := clients.MemoryCommand.Confirm(ctx, memoryID)
	require.NoError(t, err, "re-confirm must be an idempotent no-op")
	assert.Equal(t, confirmed.GetStatus().GetStateChangedAt().AsTime(),
		again.GetStatus().GetStateChangedAt().AsTime(),
		"the idempotent path must not bump the decision timestamp")

	_, err = clients.MemoryCommand.Reject(ctx, memoryID)
	requireGrpcError(t, err, codes.FailedPrecondition, memoryRejectConfirmedMessage)

	// --- update: content is the subject's; identity is locked ---
	edited := proto.Clone(confirmed).(*memoryv1.Memory)
	edited.Spec.Content = "Prefers terse answers with code examples."
	edited.Status = nil // generated update mappers send a wiped status
	updated, err := clients.MemoryCommand.Update(ctx, edited)
	require.NoError(t, err, "editing the fact text should succeed")
	assert.Equal(t, "Prefers terse answers with code examples.", updated.GetSpec().GetContent())
	assert.Equal(t, memoryv1.MemoryLifecycleState_lifecycle_state_confirmed,
		updated.GetStatus().GetLifecycleState(),
		"an update must never touch the consent lifecycle")

	reaimed := proto.Clone(updated).(*memoryv1.Memory)
	reaimed.Spec.SubjectIdentityAccountId = "ida_someone_else"
	_, err = clients.MemoryCommand.Update(ctx, reaimed)
	requireGrpcError(t, err, codes.FailedPrecondition, memorySubjectImmutableMsg)

	// --- the reject arc on a second record ---
	proposed, err := clients.MemoryCommand.Create(ctx, newMemory(org, "Not actually true."))
	require.NoError(t, err)
	proposedID := &memoryv1.MemoryId{Value: proposed.GetMetadata().GetId()}

	rejected, err := clients.MemoryCommand.Reject(ctx, proposedID)
	require.NoError(t, err)
	assert.Equal(t, memoryv1.MemoryLifecycleState_lifecycle_state_rejected,
		rejected.GetStatus().GetLifecycleState())

	_, err = clients.MemoryCommand.Confirm(ctx, proposedID)
	requireGrpcError(t, err, codes.FailedPrecondition, memoryConfirmRejectedMessage)

	// --- list: org-scoped, both records visible to their subject ---
	list, err := clients.MemoryQuery.List(ctx, &memoryv1.ListMemoriesRequest{Org: org})
	require.NoError(t, err)
	require.Equal(t, int32(2), list.GetTotalCount())
	for _, item := range list.GetItems() {
		assert.Equal(t, org, item.GetMetadata().GetOrg())
	}

	// --- delete works in any lifecycle state (the trust guarantee) ---
	for _, id := range []*memoryv1.MemoryId{memoryID, proposedID} {
		deleted, deleteErr := clients.MemoryCommand.Delete(ctx, id)
		require.NoError(t, deleteErr, "delete must never be refused on lifecycle grounds")
		assert.Equal(t, id.GetValue(), deleted.GetMetadata().GetId())

		_, getErr := clients.MemoryQuery.Get(ctx, id)
		requireGrpcError(t, getErr, codes.NotFound, "")
	}
}

// TestMemory_CreateFailsClosed pins the double opt-in (DD-006 D1): the
// org switch and the caller's own switch must BOTH be on, each refusal
// carrying its pinned cross-edition copy, and the ceiling refuses
// visibly (DD-006 D5).
func TestMemory_CreateFailsClosed(t *testing.T) {
	clients := requireMemoryClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()

	// Org switch off (account switch on): the org half refuses first.
	enableAccountMemory(t, ctx, clients)
	disabledOrg := createMemoryOrg(t, ctx, clients, false)
	_, err := clients.MemoryCommand.Create(ctx, newMemory(disabledOrg, "A fact."))
	requireGrpcError(t, err, codes.FailedPrecondition,
		fmt.Sprintf(memoryDisabledMessageFmt, disabledOrg))

	// The per-subject ceiling: fill to 100, then refuse visibly.
	enabledOrg := createMemoryOrg(t, ctx, clients, true)
	for i := 0; i < 100; i++ {
		_, createErr := clients.MemoryCommand.Create(ctx,
			newMemory(enabledOrg, fmt.Sprintf("Fact number %d.", i)))
		require.NoError(t, createErr, "create %d should be under the ceiling", i)
	}
	_, err = clients.MemoryCommand.Create(ctx, newMemory(enabledOrg, "One too many."))
	requireGrpcError(t, err, codes.FailedPrecondition, memoryFullMessage)
}

// TestMemory_CreateRequiresAccountOptIn pins the member half of the
// double opt-in in isolation: org on, account off (the default) refuses
// with the account copy — memory never operates on an implicit yes.
func TestMemory_CreateRequiresAccountOptIn(t *testing.T) {
	clients := requireMemoryClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Deliberately NOT calling enableAccountMemory: the suite identity's
	// default preferences carry memory_enabled=false. Guard against a
	// polluted default so the assertion below cannot pass for the wrong
	// reason.
	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err)
	require.False(t, account.GetSpec().GetPreferences().GetMemoryEnabled(),
		"suite identity must start with the memory opt-in off (default)")

	org := createMemoryOrg(t, ctx, clients, true)
	_, err = clients.MemoryCommand.Create(ctx, newMemory(org, "A fact."))
	requireGrpcError(t, err, codes.FailedPrecondition, memoryAccountDisabledMessage)
}

// TestMemory_StrictCallerGate pins DD-002 D4 as inherited by capture
// (DD-005 D2): a PlatformClient-minted user token — the embedder
// end-user credential — is refused at create even with every enablement
// switch on. Client-side context never overrides the control plane's
// caller classification.
func TestMemory_StrictCallerGate(t *testing.T) {
	clients := requireMemoryClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	enableAccountMemory(t, ctx, clients)
	org := createMemoryOrg(t, ctx, clients, true)

	creds := harness.CreatePlatformClient(t, ctx, clients)
	token := harness.MintUserToken(t, ctx, clients, creds, "mem-embedder-"+uuid.New().String()[:8])
	embedderConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	embedderClients := harness.NewClients(embedderConn)

	_, err := embedderClients.MemoryCommand.Create(ctx, newMemory(org, "A fact."))
	requireGrpcError(t, err, codes.PermissionDenied, memoryCaptureCallerMessage)
}

// TestMemory_SubjectOnlyIsolation pins the ratified visibility model
// (DD-004): another identity — even one that can be granted org roles —
// cannot read, decide on, or delete someone else's memory, and their
// list never includes it. Content is subject-only; the FGA denial
// arrives as PERMISSION_DENIED because the record exists (#224:
// load-before-authorize).
func TestMemory_SubjectOnlyIsolation(t *testing.T) {
	if !testHarness.FGAEnabled() {
		t.Skip("FGA not enabled in this harness run")
	}

	clients := requireMemoryClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	enableAccountMemory(t, ctx, clients)
	org := createMemoryOrg(t, ctx, clients, true)

	created, err := clients.MemoryCommand.Create(ctx, newMemory(org, "Only mine to see."))
	require.NoError(t, err)
	memoryID := &memoryv1.MemoryId{Value: created.GetMetadata().GetId()}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_, _ = clients.MemoryCommand.Delete(cleanupCtx, memoryID)
	})

	// The outsider: a fresh minted identity with no relation to the record.
	creds := harness.CreatePlatformClient(t, ctx, clients)
	token := harness.MintUserToken(t, ctx, clients, creds, "mem-outsider-"+uuid.New().String()[:8])
	outsiderConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	outsider := harness.NewClients(outsiderConn)

	_, err = outsider.MemoryQuery.Get(ctx, memoryID)
	requireGrpcError(t, err, codes.PermissionDenied, "")

	_, err = outsider.MemoryCommand.Confirm(ctx, memoryID)
	requireGrpcError(t, err, codes.PermissionDenied, "")

	_, err = outsider.MemoryCommand.Delete(ctx, memoryID)
	requireGrpcError(t, err, codes.PermissionDenied, "")

	list, err := outsider.MemoryQuery.List(ctx, &memoryv1.ListMemoriesRequest{Org: org})
	require.NoError(t, err, "list is always answerable — it filters, never refuses")
	assert.Empty(t, list.GetItems(), "another identity's list must never include my memories")
}
