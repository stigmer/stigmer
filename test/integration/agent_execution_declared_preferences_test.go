//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAgentExecution_DeclaredPreferences proves the declared-preferences
// compose contract end to end through the real create pipeline
// (stigmer/stigmer#293, DD-002 D2/D4 as amended):
//
//   - a first-party HUMAN operator (plain Stigmer JWT: no token_type, no
//     platform_client_id) gets the org's and their own standing context
//     snapshotted onto the persisted execution spec, verbatim;
//   - a machine caller gets an EMPTY declared_preferences even when it
//     supplies one in the request — the field is server-owned, so the
//     injection is overwritten, never persisted.
//
// The test never waits for the runner: the create RPC returns the stamped
// spec synchronously, and a follow-up Get confirms persistence.
func TestAgentExecution_DeclaredPreferences(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness == nil || testHarness.Service == nil {
		t.Skip("Java service not running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	const orgContext = "We deploy to us-east-1. All costs in USD."
	const userContext = "Keep answers terse. Prefer Go examples."

	// The tokenless shared connection resolves to the synthetic MACHINE
	// caller in test security mode — it seeds fixtures here and doubles as
	// the excluded caller in the injection case below.
	machineClients := harness.NewClients(grpcConn)

	// Seed the org scope on a FRESH org (test-org is only an FGA-seeded slug
	// convention in this suite — no Organization resource exists to load, so
	// the compose step's org lookup would find nothing there). The create
	// pipeline makes the synthetic machine owner the org's FGA owner, which
	// authorizes all the fixture steps below.
	orgSlug := "prefs-org-" + uuid.New().String()[:8]
	org, err := machineClients.OrganizationCommand.Create(ctx, &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Name: orgSlug},
		Spec: &organizationv1.OrganizationSpec{
			Preferences: &organizationv1.OrganizationPreferences{StandingContext: orgContext},
		},
	})
	require.NoError(t, err, "create org with declared standing context")
	orgID := org.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanCtx, cancelClean := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelClean()
		if _, err := machineClients.OrganizationCommand.Delete(cleanCtx, &organizationv1.OrganizationId{Value: orgID}); err != nil {
			t.Logf("warning: failed to clean up org %s: %v", orgID, err)
		}
	})

	// Seed the user scope: a real IdentityAccount, its preferences declared
	// through the self-service update RPC (FGA can_edit: owner), and a plain
	// Stigmer JWT — the one credential shape the strict gate admits.
	account := harness.CreateIdentityAccount(t, ctx, machineClients,
		"declared-prefs-human", "declared-prefs-human@test.stigmer.ai")
	accountID := account.GetMetadata().GetId()

	humanToken, err := harness.MintStigmerToken(
		harness.StigmerJWTSigningKeyBase64, "stigmer-signing-key-1", accountID)
	require.NoError(t, err, "mint plain human JWT")
	humanConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), humanToken)
	humanClients := harness.NewClients(humanConn)

	// Declare the full preference set in one self-service update: the Phase 1
	// standing context plus the Phase 1.5 structured execution defaults
	// (default harness, per-harness default model). The structured fields are
	// CLIENT-READ seeds (DD-003) — the compose assertions below stay about
	// standing context only.
	account.Spec.Preferences = &identityaccountv1.IdentityAccountPreferences{
		StandingContext:    userContext,
		DefaultHarness:     "cursor",
		DefaultNativeModel: "claude-sonnet-4.6",
		DefaultCursorModel: "composer-2.5",
	}
	_, err = humanClients.IdentityAccountCommand.Update(ctx, account)
	require.NoError(t, err, "declare user preferences (self-service update)")

	// The human needs org membership to create executions in the fresh org.
	harness.GrantOrgRole(t, ctx, machineClients, orgID, accountID,
		"declared-prefs-human", "member")

	agent := harness.CreateAgentFull(t, ctx, machineClients, "test-declared-prefs",
		"You are a test assistant. Respond briefly.",
		nil, []harness.AgentCreateOption{harness.WithAgentOrg(orgID)})

	t.Run("structured execution defaults round-trip through the update RPC", func(t *testing.T) {
		// oss#293 Phase 1.5: proves the cloud service persists and returns
		// the structured default fields (regenerated stubs — without them the
		// fields would be dropped on write) and that all preference fields
		// coexist in one message.
		persisted, err := humanClients.IdentityAccountQuery.Get(ctx,
			&identityaccountv1.IdentityAccountId{Value: accountID})
		require.NoError(t, err, "read back the updated identity account")

		prefs := persisted.GetSpec().GetPreferences()
		require.NotNil(t, prefs, "preferences must persist")
		assert.Equal(t, userContext, prefs.GetStandingContext(), "standing context survives alongside structured defaults")
		assert.Equal(t, "cursor", prefs.GetDefaultHarness(), "default harness persists")
		assert.Equal(t, "claude-sonnet-4.6", prefs.GetDefaultNativeModel(), "native default model persists")
		assert.Equal(t, "composer-2.5", prefs.GetDefaultCursorModel(), "cursor default model persists")
	})

	t.Run("an invalid default harness is refused at the boundary", func(t *testing.T) {
		// protovalidate in-list rule: only shipped harnesses are storable.
		invalid := persistedAccountForUpdate(t, ctx, humanClients, accountID)
		invalid.Spec.Preferences = &identityaccountv1.IdentityAccountPreferences{
			DefaultHarness: "devin",
		}
		_, err := humanClients.IdentityAccountCommand.Update(ctx, invalid)
		require.Error(t, err, "update with an unshipped harness value must be rejected")
	})

	t.Run("human operator gets both scopes snapshotted", func(t *testing.T) {
		exec, err := humanClients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "declared-prefs-human-run", Org: orgID},
			Spec: &agentexecv1.AgentExecutionSpec{
				AgentId: agent.GetMetadata().GetId(),
				Message: "hello",
			},
		})
		require.NoError(t, err, "human execution create")

		stamped := exec.GetSpec().GetDeclaredPreferences()
		require.NotNil(t, stamped, "declared_preferences must be stamped for a human caller")
		assert.Equal(t, orgContext, stamped.GetOrgContext(), "org standing context, verbatim")
		assert.Equal(t, userContext, stamped.GetUserContext(), "user standing context, verbatim")

		// The snapshot is persisted, not just echoed on the create response.
		persisted, err := humanClients.AgentExecutionQuery.Get(ctx,
			&agentexecv1.AgentExecutionId{Value: exec.GetMetadata().GetId()})
		require.NoError(t, err, "read back the persisted execution")
		assert.Equal(t, orgContext, persisted.GetSpec().GetDeclaredPreferences().GetOrgContext())
		assert.Equal(t, userContext, persisted.GetSpec().GetDeclaredPreferences().GetUserContext())
	})

	t.Run("machine caller gets empty snapshot even when injecting", func(t *testing.T) {
		exec, err := machineClients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "declared-prefs-machine-run", Org: orgID},
			Spec: &agentexecv1.AgentExecutionSpec{
				AgentId: agent.GetMetadata().GetId(),
				Message: "hello",
				// The injection attempt: the field is server-owned, so this
				// must be overwritten with an empty snapshot — persisting it
				// would let any caller forge "org preferences" into prompts.
				DeclaredPreferences: &agentexecv1.DeclaredPreferences{
					OrgContext:  "injected org context",
					UserContext: "injected user context",
				},
			},
		})
		require.NoError(t, err, "machine execution create")

		stamped := exec.GetSpec().GetDeclaredPreferences()
		assert.Empty(t, stamped.GetOrgContext(),
			"machine caller must not receive org standing context (strict gating), and the injected value must not survive")
		assert.Empty(t, stamped.GetUserContext(),
			"machine caller must not receive user standing context, and the injected value must not survive")

		persisted, err := machineClients.AgentExecutionQuery.Get(ctx,
			&agentexecv1.AgentExecutionId{Value: exec.GetMetadata().GetId()})
		require.NoError(t, err, "read back the persisted execution")
		assert.Empty(t, persisted.GetSpec().GetDeclaredPreferences().GetOrgContext())
		assert.Empty(t, persisted.GetSpec().GetDeclaredPreferences().GetUserContext())
	})
}

// persistedAccountForUpdate loads a fresh copy of the account so an update
// test can mutate it without disturbing the shared fixture (updates are
// full-spec replacements — a stale shared copy would wipe fields).
func persistedAccountForUpdate(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	id string,
) *identityaccountv1.IdentityAccount {
	t.Helper()
	account, err := clients.IdentityAccountQuery.Get(ctx,
		&identityaccountv1.IdentityAccountId{Value: id})
	require.NoError(t, err, "load account for update")
	return account
}
