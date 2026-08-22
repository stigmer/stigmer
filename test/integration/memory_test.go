//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The exact contract string shared with the OSS Go edition and the cloud
// MemoryPolicy (the backend-engineer rule: same error contracts in both
// editions). A change on any side must change all of them.
const memoryCaptureCallerMessage = "memory can only be captured for a first-party human operator"

// COVERAGE MAP for the memory kind on the cloud edition — why this file
// pins only the capture gate's REFUSALS:
//
// Memory create is guarded by the capture-eligibility gate (DD-002 D4 as
// amended, inherited by capture — DD-005 D2; widened for the remember
// tool by the Stage 3 decision, owner-ratified 2026-08-22). The suite's
// default credentials are both excluded: the tokenless identity is
// deliberately machine-class (IntegrationTestSecurityConfig), and every
// PlatformClient-minted token is an embedder end-user. TWO credentials
// are admitted: a plain Stigmer JWT (harness.MintStigmerToken — the
// declared-preferences precedent, session-3 learning), which Stage 2's
// TestAgentExecution_RecalledMemories uses to exercise capture + confirm
// through the front door, and the session-scoped SANDBOX token
// (harness.MintSandboxTokenForOrg), which Stage 3's
// TestMemory_SandboxCapture uses to exercise the remember tool's write
// path (subject from sub, verified provenance, org binding, and the
// session-less runner types' refusals). Seeding memory rows behind the
// service's back stays off the table (the IdentitySeeder doctrine: the
// pre-auth bootstrap is the ONLY legitimate direct Tier-1 write;
// everything else seeds through the front door).
//
// The full behavioral matrix lives where each slice is best reachable:
//   - OSS edition over the wire: test/conformance memory suite (create,
//     double opt-in, cap, consent lifecycle, immutability, list, delete).
//   - Cloud handlers: MemoryCreateHandlerTest / MemoryUpdateHandlerTest /
//     MemoryLifecycleTransitionTest (the gate matrix by caller class,
//     enablement fail-closed, cap, transitions — Mockito) +
//     ComposeRecalledMemoriesStepTest (the recall gate matrix).
//   - Cloud storage: MemoryRepoContractTest against real Postgres +
//     AppPostgresBaselineDdlTest (V45 shape).
//   - The FGA model: memory-subject-only.fga.yaml (subject-only
//     visibility incl. org-admin denial) + ProtoFgaSchemaConsistencyTest.
//   - The recall loop over the wire (Stage 2):
//     agent_execution_recalled_memories_test.go — capture, confirm, and
//     the compose snapshot (confirmed-only, oldest-first, server-owned
//     overwrite, double opt-in) against the real create pipeline.
//
// What THIS file pins is the gate refusing both excluded caller classes
// at the create RPC, with the cross-edition copy.
func TestMemory_CaptureGateRefusesExcludedCallers(t *testing.T) {
	clients := harness.NewClients(grpcConn)
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// An org with the memory switch ON, so the ONLY refusal reason left
	// is the caller gate.
	org, err := clients.OrganizationCommand.Create(ctx, &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "mem-org-" + uuid.New().String()[:8]},
		Spec: &organizationv1.OrganizationSpec{
			Preferences: &organizationv1.OrganizationPreferences{MemoryEnabled: true},
		},
	})
	require.NoError(t, err, "create memory test org")
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_, _ = clients.OrganizationCommand.Delete(cleanupCtx,
			&organizationv1.OrganizationId{Value: org.GetMetadata().GetId()})
	})

	memory := &memoryv1.Memory{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Memory",
		Metadata:   &apiresource.ApiResourceMetadata{Org: org.GetMetadata().GetSlug()},
		Spec:       &memoryv1.MemorySpec{Content: "A fact the gate must refuse to store."},
	}

	requireGateRefusal := func(t *testing.T, err error, callerClass string) {
		t.Helper()
		require.Error(t, err, "%s must be refused at the capture gate", callerClass)
		st, ok := status.FromError(err)
		require.True(t, ok)
		require.Equal(t, codes.PermissionDenied, st.Code(),
			"%s: expected the gate's PERMISSION_DENIED, got %s (%s)",
			callerClass, st.Code(), st.Message())
		require.Contains(t, st.Message(), memoryCaptureCallerMessage,
			"%s: the refusal must carry the cross-edition copy", callerClass)
	}

	t.Run("machine-class caller", func(t *testing.T) {
		// The suite's tokenless identity is deliberately machine-class —
		// exactly the credential shape a background system integration
		// would present.
		_, err := clients.MemoryCommand.Create(ctx, memory)
		requireGateRefusal(t, err, "machine-class caller")
	})

	t.Run("platform-client user token (embedder end-user)", func(t *testing.T) {
		// The one human credential the owner amendment deliberately
		// excludes: facts about an embedder's end-user must not be
		// captured into the org's memory surface (DD-002 D4).
		creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
		token := harness.MintUserToken(t, ctx, clients, creds,
			"mem-embedder-"+uuid.New().String()[:8])
		embedderConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
		embedder := harness.NewClients(embedderConn)

		_, err := embedder.MemoryCommand.Create(ctx, memory)
		requireGateRefusal(t, err, "platform-client user token")
	})
}
