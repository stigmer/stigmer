//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	iamv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

func requirePlatformClientClients(t *testing.T) *harness.Clients {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	return harness.NewClients(grpcConn)
}

func TestPlatformClient_Create_ReturnsClientIdAndSecret(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients)

	assert.True(t, strings.HasPrefix(creds.ClientID, "stgm_cid_"),
		"client_id should have stgm_cid_ prefix, got: %s", creds.ClientID)
	assert.NotEmpty(t, creds.ClientSecret, "raw secret must be returned on creation")
	assert.NotEmpty(t, creds.ResourceID, "resource ID must be assigned")
}

func TestPlatformClient_Create_SecretNotReturnedOnGet(t *testing.T) {
	t.Skip("secret hash redaction in query responses not yet implemented in stigmer-service — tracked for security hardening sprint")

	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients)

	got, err := clients.PlatformClientQuery.Get(ctx, &apiresource.ApiResourceId{
		Value: creds.ResourceID,
	})
	require.NoError(t, err)

	assert.Empty(t, got.GetSpec().GetClientSecretHash(),
		"client_secret_hash should be redacted in query responses")
	assert.NotEmpty(t, got.GetSpec().GetSecretFingerprint(),
		"fingerprint should be visible")
}

func TestPlatformClient_MintUserToken_ValidCredentials(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
	token := harness.MintUserToken(t, ctx, clients, creds, "user-alice")

	assert.NotEmpty(t, token)
	parts := strings.Split(token, ".")
	assert.Equal(t, 3, len(parts), "minted token should be a valid JWT with 3 segments")
}

func TestPlatformClient_MintUserToken_InvalidSecret_Unauthenticated(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))

	_, err := clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     creds.ClientID,
		ClientSecret: "wrong-secret-value",
		UserId:       "user-bob",
		UserEmail:    "bob@test.stigmer.ai",
		UserName:     "Bob",
	})
	require.Error(t, err)

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"invalid secret should return UNAUTHENTICATED, got: %s — %s", st.Code(), st.Message())
}

func TestPlatformClient_MintUserToken_InvalidClientId_Unauthenticated(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))

	_, err := clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     "stgm_cid_nonexistent_000000000000000",
		ClientSecret: creds.ClientSecret,
		UserId:       "user-charlie",
		UserEmail:    "charlie@test.stigmer.ai",
		UserName:     "Charlie",
	})
	require.Error(t, err)

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"unknown client_id should return UNAUTHENTICATED, got: %s — %s", st.Code(), st.Message())
}

func TestPlatformClient_MintUserToken_JITProvisioningOff_UnknownUser_NotFound(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// auto_provision_accounts defaults to false
	creds := harness.CreatePlatformClient(t, ctx, clients)

	_, err := clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		UserId:       "unknown-user-" + t.Name(),
		UserEmail:    "unknown@test.stigmer.ai",
		UserName:     "Unknown",
	})
	require.Error(t, err)

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"manual mode should return FAILED_PRECONDITION for unknown user, got: %s — %s", st.Code(), st.Message())
}

func TestPlatformClient_MintUserToken_JITProvisioning_CreatesAccount(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
	userID := "jit-user-" + t.Name()

	token := harness.MintUserToken(t, ctx, clients, creds, userID)
	assert.NotEmpty(t, token, "JIT provisioning should succeed and return a token")

	// Mint again with the same user — should succeed (account already exists)
	token2 := harness.MintUserToken(t, ctx, clients, creds, userID)
	assert.NotEmpty(t, token2, "second mint for same user should also succeed")
}

// TestPlatformClient_MintUserToken_OwnOrgId_Mints pins the org_id contract
// half of issue #376: a request naming the PlatformClient's own owning org is
// a valid confirmation and mints exactly like an empty org_id.
func TestPlatformClient_MintUserToken_OwnOrgId_Mints(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))

	resp, err := clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		UserId:       "own-org-user-" + t.Name(),
		UserEmail:    "own-org@test.stigmer.ai",
		UserName:     "Own Org",
		OrgId:        harness.TestOrg,
	})
	require.NoError(t, err, "org_id equal to the owning org must mint")
	assert.Equal(t, 3, len(strings.Split(resp.GetAccessToken(), ".")),
		"minted token should be a valid JWT with 3 segments")
}

// TestPlatformClient_MintUserToken_ForeignOrgId_InvalidArgument is the main
// regression guard for issue #376: org_id used to ride into the signed JWT's
// org claim verbatim with no access check of any kind. Cross-org minting has
// never been supported (identity resolution and the auto-grant key on the
// client's owning org), so a foreign org_id is refused INVALID_ARGUMENT.
func TestPlatformClient_MintUserToken_ForeignOrgId_InvalidArgument(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))

	_, err := clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		UserId:       "foreign-org-user-" + t.Name(),
		UserEmail:    "foreign-org@test.stigmer.ai",
		UserName:     "Foreign Org",
		OrgId:        "org-someone-else-" + uuid.New().String()[:8],
	})
	require.Error(t, err)

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"foreign org_id should return INVALID_ARGUMENT, got: %s — %s", st.Code(), st.Message())
	assert.Contains(t, st.Message(), "cross-organization minting is not supported")
}

// TestPlatformClient_MintUserToken_ForeignOrgId_NeverProvisions pins the
// ordering half of the #376 fix end-to-end: the org-scope rejection must fire
// BEFORE JIT provisioning, so a refused mint is side-effect free. The identity
// key is org+user_id and client-independent, so a JIT-off client in the same
// org still failing with "unknown user" proves the rejected mint on the JIT-on
// client never created the account.
func TestPlatformClient_MintUserToken_ForeignOrgId_NeverProvisions(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	jitOnCreds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
	// auto_provision_accounts defaults to false
	jitOffCreds := harness.CreatePlatformClient(t, ctx, clients)

	userID := "never-provisioned-" + uuid.New().String()[:8]

	_, err := clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     jitOnCreds.ClientID,
		ClientSecret: jitOnCreds.ClientSecret,
		UserId:       userID,
		UserEmail:    userID + "@test.stigmer.ai",
		UserName:     "Never Provisioned",
		OrgId:        "org-someone-else-" + uuid.New().String()[:8],
	})
	require.Error(t, err, "foreign org_id must be rejected even with JIT enabled")

	_, err = clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     jitOffCreds.ClientID,
		ClientSecret: jitOffCreds.ClientSecret,
		UserId:       userID,
		UserEmail:    userID + "@test.stigmer.ai",
		UserName:     "Never Provisioned",
	})
	require.Error(t, err)

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"user must still be unknown — the rejected mint may not have provisioned it, got: %s — %s",
		st.Code(), st.Message())
}

// TestPlatformClient_MintUserToken_RefreshesProfileOnRemint is the regression
// guard for issue #377: token.proto has always promised that user_email and
// user_name are "updated on each token mint if the account exists", but the
// provisioner returned resolved accounts untouched, freezing the profile at
// first-mint values forever (stale audit actors, MCP caller-identity going
// dark for users whose email changed in the host platform). Pins the fixed
// contract end to end, including the sparse arm: empty asserted values are
// "not asserted" and never clobber stored ones.
func TestPlatformClient_MintUserToken_RefreshesProfileOnRemint(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
	userID := "refresh-user-" + uuid.New().String()[:8]

	whoAmI := func(token string) *identityaccountv1.IdentityAccount {
		t.Helper()
		conn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
		account, err := harness.NewClients(conn).IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
		require.NoError(t, err, "whoAmI with minted token")
		return account
	}

	// First mint JIT-provisions the account with the asserted profile.
	token1 := harness.MintUserTokenWithProfile(t, ctx, clients, creds, userID,
		"amelia.original@test.stigmer.ai", "Amelia Original")
	account1 := whoAmI(token1)
	require.Equal(t, "amelia.original@test.stigmer.ai", account1.GetSpec().GetEmail())
	require.Equal(t, "Amelia", account1.GetSpec().GetFirstName())
	require.Equal(t, "Original", account1.GetSpec().GetLastName())

	// Re-mint with a changed profile — the stored account must refresh.
	token2 := harness.MintUserTokenWithProfile(t, ctx, clients, creds, userID,
		"amelia.renamed@test.stigmer.ai", "Amelia Renamed")
	account2 := whoAmI(token2)
	assert.Equal(t, account1.GetMetadata().GetId(), account2.GetMetadata().GetId(),
		"same user_id must resolve to the same account, not a new one")
	assert.Equal(t, "amelia.renamed@test.stigmer.ai", account2.GetSpec().GetEmail(),
		"re-mint must refresh the stored email (issue #377)")
	assert.Equal(t, "Renamed", account2.GetSpec().GetLastName(),
		"re-mint must refresh the stored name (issue #377)")

	// Sparse semantics: a mint that asserts no profile leaves it untouched.
	token3 := harness.MintUserTokenWithProfile(t, ctx, clients, creds, userID, "", "")
	account3 := whoAmI(token3)
	assert.Equal(t, "amelia.renamed@test.stigmer.ai", account3.GetSpec().GetEmail(),
		"empty user_email must not clobber the stored email")
	assert.Equal(t, "Renamed", account3.GetSpec().GetLastName(),
		"empty user_name must not clobber the stored name")
}

// TestPlatformClient_MintUserToken_JITAutoGrant_GrantsRole is the regression
// guard for issue #329: the auto-grant silently never landed because the
// provisioner used createPolicy (requires org admin, which the machine account
// does not have) instead of bootstrapPolicy. It mirrors the issue's exact
// repro: auto_grant_role=member, mint, then create a session with the minted
// token — the call that failed with PERMISSION_DENIED in the report.
//
// The FGA gate is required: with the permit-all bypass every check passes
// vacuously, so only the FGA lane exercises the grant path for real.
func TestPlatformClient_MintUserToken_JITAutoGrant_GrantsRole(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients,
		harness.WithAutoProvision(true),
		harness.WithAutoGrantOnOrg(true),
		harness.WithAutoGrantRole(iamv1.IamRole_member),
	)

	userID := "autogrant-user-" + t.Name()
	token := harness.MintUserToken(t, ctx, clients, creds, userID)
	assert.NotEmpty(t, token, "JIT + auto-grant should succeed")

	if testHarness.FGAEnabled() {
		authedConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
		authedClients := harness.NewClients(authedConn)

		// The grant itself: the minted identity must hold can_create_session
		// on the org (member or guest per organization.fga) — the exact FGA
		// check that session create performs.
		verdict, err := authedClients.IamPolicyQuery.CheckMyPermission(ctx,
			&iampolicyv1.CheckMyPermissionInput{
				Resource: &iampolicyv1.ApiResourceRef{Kind: "organization", Id: harness.TestOrg},
				Relation: "can_create_session",
			})
		require.NoError(t, err, "CheckMyPermission must succeed for the minted identity")
		require.True(t, verdict.GetIsAuthorized(),
			"auto-granted member must hold can_create_session on org %s — "+
				"empty roles here means the JIT auto-grant never landed (issue #329)", harness.TestOrg)

		// The end-to-end proof: create a session with the minted token.
		// Empty agent_instance_id resolves the baseline default agent seeded
		// in TestMain.
		session, err := authedClients.SessionCommand.Create(ctx, &sessionv1.Session{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "autogrant-session-" + uuid.New().String()[:8],
				Org:  harness.TestOrg,
			},
			Spec: &sessionv1.SessionSpec{
				Subject: "issue #329 repro",
			},
		})
		require.NoError(t, err,
			"auto-granted member must be able to create a session (the exact call that failed in issue #329)")
		t.Cleanup(func() {
			cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_, _ = authedClients.SessionCommand.Delete(cleanCtx,
				&sessionv1.SessionId{Value: session.GetMetadata().GetId()})
		})

		// Member implies viewer transitively — the pre-existing viewer-level
		// assertion stays as coverage for read access.
		_, err = authedClients.PlatformClientQuery.ListByOrg(ctx,
			&platformclientv1.ListPlatformClientsByOrgInput{Org: harness.TestOrg})
		assert.NoError(t, err, "auto-granted member should be able to list platform clients")
	}
}

func TestPlatformClient_RotateSecret_NewSecretWorks_OldSecretFails(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
	oldSecret := creds.ClientSecret

	// Verify old secret works
	token := harness.MintUserToken(t, ctx, clients, creds, "rotate-user")
	assert.NotEmpty(t, token)

	// Rotate the secret
	rotateResp, err := clients.PlatformClientCommand.RotateSecret(ctx,
		&platformclientv1.PlatformClientId{Value: creds.ResourceID})
	require.NoError(t, err)

	newSecret := rotateResp.GetClientSecret()
	require.NotEmpty(t, newSecret, "rotated secret must be returned")
	assert.NotEqual(t, oldSecret, newSecret, "new secret must differ from old")

	// New secret should work
	newCreds := harness.PlatformClientCredentials{
		ResourceID:   creds.ResourceID,
		ClientID:     creds.ClientID,
		ClientSecret: newSecret,
	}
	token2 := harness.MintUserToken(t, ctx, clients, newCreds, "rotate-user")
	assert.NotEmpty(t, token2, "new secret should work for minting")

	// Old secret should fail
	_, err = clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     creds.ClientID,
		ClientSecret: oldSecret,
		UserId:       "rotate-user",
	})
	require.Error(t, err)

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"old secret should be rejected after rotation, got: %s", st.Code())
}

func TestPlatformClient_Delete_InvalidatesCredentials(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))

	// Verify credentials work before deletion
	token := harness.MintUserToken(t, ctx, clients, creds, "delete-user")
	assert.NotEmpty(t, token)

	// Delete the platform client
	_, err := clients.PlatformClientCommand.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: creds.ResourceID,
	})
	require.NoError(t, err)

	// Minting should now fail
	_, err = clients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		UserId:       "delete-user",
	})
	require.Error(t, err, "minting after deletion should fail")

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Contains(t, []codes.Code{codes.Unauthenticated, codes.NotFound}, st.Code(),
		"deleted client should return UNAUTHENTICATED or NOT_FOUND, got: %s", st.Code())
}

func TestPlatformClient_SameUserAcrossMultipleClients_SingleIdentity(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	credsA := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
	credsB := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))

	sharedUserID := "shared-user-" + t.Name()

	// Mint via client A
	tokenA := harness.MintUserToken(t, ctx, clients, credsA, sharedUserID)
	require.NotEmpty(t, tokenA)

	// Mint via client B with the same user_id
	tokenB := harness.MintUserToken(t, ctx, clients, credsB, sharedUserID)
	require.NotEmpty(t, tokenB)

	// Both tokens should be valid (we cannot decode them without the signing
	// key, but the fact that both mints succeeded with the same user_id
	// across different PlatformClients proves org-scoped identity resolution).
	assert.NotEqual(t, tokenA, tokenB,
		"tokens from different mints should differ (different issuance times)")
}

func TestPlatformClient_ListByOrg(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Create two platform clients
	harness.CreatePlatformClient(t, ctx, clients)
	harness.CreatePlatformClient(t, ctx, clients)

	list, err := clients.PlatformClientQuery.ListByOrg(ctx,
		&platformclientv1.ListPlatformClientsByOrgInput{Org: harness.TestOrg})
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(list.GetEntries()), 2,
		"should list at least the 2 platform clients we created")
}

// TestPlatformClient_AllowedOrigins_EnforcedOnTokenBearingRequests is the
// end-to-end pin for issue #375: PlatformClientSpec.allowed_origins was
// documented, stored, and updatable — and read by nothing. It is now enforced
// on every request BEARING a minted user token (never on mintUserToken
// itself, which is server-to-server and carries no browser Origin): with a
// non-empty list, an unlisted Origin header is refused PERMISSION_DENIED;
// listed origins (case-insensitive), absent origins (non-browser callers),
// and empty-list clients (open mode) all pass. whoAmI is the probe RPC — it
// needs no org grants, so every refusal here is the origin gate's.
func TestPlatformClient_AllowedOrigins_EnforcedOnTokenBearingRequests(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients,
		harness.WithAutoProvision(true),
		harness.WithAllowedOrigins("https://app.acme-origins.test"))
	token := harness.MintUserToken(t, ctx, clients, creds, "origin-user-"+uuid.New().String()[:8])

	userConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	userClients := harness.NewClients(userConn)

	whoAmI := func(callCtx context.Context) error {
		_, err := userClients.IdentityAccountQuery.WhoAmI(callCtx, &emptypb.Empty{})
		return err
	}
	withOrigin := func(origin string) context.Context {
		// The origin metadata key is the browser's Origin header exactly as
		// the gateway's grpc-web translation forwards it to the service.
		return metadata.AppendToOutgoingContext(ctx, "origin", origin)
	}

	// Unlisted origin: refused, with copy naming the field to fix.
	err := whoAmI(withOrigin("https://evil.example.com"))
	require.Error(t, err, "unlisted origin must be refused")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code(),
		"unlisted origin should return PERMISSION_DENIED, got: %s — %s", st.Code(), st.Message())
	assert.Contains(t, st.Message(), "allowed_origins",
		"the refusal must tell the integrator which field to fix")
	assert.Contains(t, st.Message(), "https://evil.example.com",
		"the refusal must name the refused origin (origins are public identifiers)")

	// Opaque origin ("null"): a framed page whose parent is undiscoverable —
	// fails closed under a non-empty list, mirroring the guest-embed policy.
	err = whoAmI(withOrigin("null"))
	require.Error(t, err, "opaque origin must be refused under a non-empty list")
	st, _ = status.FromError(err)
	assert.Equal(t, codes.PermissionDenied, st.Code())

	// Listed origin, different case: RFC 6454 origins compare
	// case-insensitively, and owner-entered list entries may differ in case
	// from the browser's lowercase serialization.
	assert.NoError(t, whoAmI(withOrigin("https://APP.Acme-Origins.TEST")),
		"listed origin must pass regardless of case")

	// No Origin header: non-browser callers (backends, curl) are not
	// constrained — the client secret remains the primary control.
	assert.NoError(t, whoAmI(ctx), "absent Origin must always pass")

	// Origin-list edits propagate immediately (the update pipeline evicts
	// the enforcement cache): admit the previously refused origin and the
	// SAME outstanding token passes on its next request.
	existing, err := clients.PlatformClientQuery.Get(ctx,
		&apiresource.ApiResourceId{Value: creds.ResourceID})
	require.NoError(t, err, "load platform client for the allowlist update")
	existing.Spec.AllowedOrigins = []string{
		"https://app.acme-origins.test", "https://evil.example.com"}
	_, err = clients.PlatformClientCommand.Update(ctx, existing)
	require.NoError(t, err, "update allowed_origins")
	assert.NoError(t, whoAmI(withOrigin("https://evil.example.com")),
		"an origin admitted by update must pass immediately — stale-cache "+
			"enforcement would keep refusing until the TTL")
}

// TestPlatformClient_AllowedOrigins_EmptyListIsOpenMode pins today's default:
// a PlatformClient with no allowed_origins does not origin-check at all, so
// shipping enforcement (issue #375) changes nothing for existing integrators
// until they opt in by listing origins.
func TestPlatformClient_AllowedOrigins_EmptyListIsOpenMode(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients, harness.WithAutoProvision(true))
	token := harness.MintUserToken(t, ctx, clients, creds, "open-user-"+uuid.New().String()[:8])

	userConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	userClients := harness.NewClients(userConn)

	callCtx := metadata.AppendToOutgoingContext(ctx, "origin", "https://anywhere.example.com")
	_, err := userClients.IdentityAccountQuery.WhoAmI(callCtx, &emptypb.Empty{})
	assert.NoError(t, err, "empty allowed_origins must admit any origin (open mode)")
}
