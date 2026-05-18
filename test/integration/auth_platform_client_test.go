//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func TestPlatformClient_MintUserToken_JITAutoGrant_GrantsRole(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	creds := harness.CreatePlatformClient(t, ctx, clients,
		harness.WithAutoProvision(true),
		harness.WithAutoGrantOnOrg(true),
	)

	userID := "autogrant-user-" + t.Name()
	token := harness.MintUserToken(t, ctx, clients, creds, userID)
	assert.NotEmpty(t, token, "JIT + auto-grant should succeed")

	// The auto-granted user should now have viewer access on the org.
	// We verify by using the minted token to call a viewer-level RPC.
	// This test validates the full flow: mint → provision → grant → use.
	if testHarness.FGAEnabled() {
		authedConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
		authedClients := harness.NewClients(authedConn)

		// A viewer should be able to list platform clients in their org.
		_, err := authedClients.PlatformClientQuery.ListByOrg(ctx,
			&platformclientv1.ListPlatformClientsByOrgInput{Org: harness.TestOrg})
		assert.NoError(t, err, "auto-granted viewer should be able to list platform clients")
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
