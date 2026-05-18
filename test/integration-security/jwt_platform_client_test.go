//go:build integration

package security

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// TestPlatformClientJWT_MintAndUse verifies the full PlatformClient flow
// through the production security chain:
//  1. Create a PlatformClient (via bootstrap auth)
//  2. Mint a user token using client credentials
//  3. Use the minted JWT to call an authenticated endpoint
//
// This exercises PlatformClientTokenAuthenticationProvider in production mode.
func TestPlatformClientJWT_MintAndUse(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	bootstrapClients := harness.NewClients(bootstrapConn)

	pcName := "test-pc-sec-" + uuid.New().String()[:8]
	pc := &platformclientv1.PlatformClient{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "PlatformClient",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: pcName,
			Org:  testOrg,
		},
		Spec: &platformclientv1.PlatformClientSpec{
			AutoProvisionAccounts: true,
		},
	}

	createResp, err := bootstrapClients.PlatformClientCommand.Create(ctx, pc)
	require.NoError(t, err, "create PlatformClient")
	require.NotEmpty(t, createResp.GetClientSecret(), "secret must be returned on create")

	created := createResp.GetPlatformClient()
	resourceID := created.GetMetadata().GetId()
	clientID := created.GetSpec().GetClientId()
	clientSecret := createResp.GetClientSecret()

	t.Logf("created PlatformClient: id=%s, client_id=%s", resourceID, clientID)

	assert.True(t, strings.HasPrefix(clientID, "stgm_cid_"),
		"client ID should have stgm_cid_ prefix, got: %s", clientID)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = bootstrapClients.PlatformClientCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: resourceID,
		})
	})

	userID := "pc-user-" + uuid.New().String()[:8]
	mintResp, err := bootstrapClients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     clientID,
		ClientSecret: clientSecret,
		UserId:       userID,
		UserEmail:    userID + "@test.stigmer.ai",
		UserName:     "PC Test User",
	})
	require.NoError(t, err, "mint user token")
	require.NotEmpty(t, mintResp.GetAccessToken(), "minted token must not be empty")
	assert.Equal(t, "Bearer", mintResp.GetTokenType())
	assert.Greater(t, mintResp.GetExpiresIn(), int32(0))

	mintedToken := mintResp.GetAccessToken()
	t.Logf("minted user token: type=%s, expires_in=%d", mintResp.GetTokenType(), mintResp.GetExpiresIn())

	// Verify the minted JWT is valid parts (header.payload.signature)
	parts := strings.Split(mintedToken, ".")
	assert.Len(t, parts, 3, "JWT should have 3 dot-separated parts")

	pcConn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), mintedToken)
	pcClients := harness.NewClients(pcConn)

	whoAmI, err := pcClients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "WhoAmI should succeed with PlatformClient-minted JWT")
	assert.NotEmpty(t, whoAmI.GetMetadata().GetId(),
		"should resolve to an identity account")

	t.Logf("PlatformClient JWT accepted: identity=%s", whoAmI.GetMetadata().GetId())
}

// TestPlatformClientJWT_RotatedSecret_OldTokenRejected verifies that after
// rotating a PlatformClient's secret, tokens minted with the old secret
// can no longer mint new tokens (the old secret is invalidated).
func TestPlatformClientJWT_RotatedSecret_OldTokenRejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	bootstrapClients := harness.NewClients(bootstrapConn)

	pcName := "test-pc-rotate-" + uuid.New().String()[:8]
	pc := &platformclientv1.PlatformClient{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "PlatformClient",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: pcName,
			Org:  testOrg,
		},
		Spec: &platformclientv1.PlatformClientSpec{
			AutoProvisionAccounts: true,
		},
	}

	createResp, err := bootstrapClients.PlatformClientCommand.Create(ctx, pc)
	require.NoError(t, err, "create PlatformClient")

	created := createResp.GetPlatformClient()
	resourceID := created.GetMetadata().GetId()
	clientID := created.GetSpec().GetClientId()
	oldSecret := createResp.GetClientSecret()

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = bootstrapClients.PlatformClientCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: resourceID,
		})
	})

	// Verify old secret works
	_, err = bootstrapClients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     clientID,
		ClientSecret: oldSecret,
		UserId:       "pre-rotate-user",
		UserEmail:    "pre-rotate@test.stigmer.ai",
		UserName:     "Pre Rotate User",
	})
	require.NoError(t, err, "mint should succeed with original secret")

	rotateResp, err := bootstrapClients.PlatformClientCommand.RotateSecret(ctx, &platformclientv1.PlatformClientId{
		Value: resourceID,
	})
	require.NoError(t, err, "rotate secret")
	newSecret := rotateResp.GetClientSecret()
	require.NotEmpty(t, newSecret, "new secret must be returned")
	assert.NotEqual(t, oldSecret, newSecret, "rotated secret should differ from original")

	t.Logf("rotated PlatformClient secret: id=%s", resourceID)

	// Old secret should now be rejected
	_, err = bootstrapClients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     clientID,
		ClientSecret: oldSecret,
		UserId:       "post-rotate-user",
		UserEmail:    "post-rotate@test.stigmer.ai",
		UserName:     "Post Rotate User",
	})
	require.Error(t, err, "mint should fail with old (rotated) secret")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Contains(t,
		[]codes.Code{codes.Unauthenticated, codes.PermissionDenied, codes.InvalidArgument},
		st.Code(),
		"old secret should be rejected, got %s: %s", st.Code(), st.Message())

	// New secret should work
	mintResp, err := bootstrapClients.PlatformClientToken.MintUserToken(ctx, &platformclientv1.MintUserTokenRequest{
		ClientId:     clientID,
		ClientSecret: newSecret,
		UserId:       "new-secret-user",
		UserEmail:    "new-secret@test.stigmer.ai",
		UserName:     "New Secret User",
	})
	require.NoError(t, err, "mint should succeed with new secret")
	require.NotEmpty(t, mintResp.GetAccessToken(), "minted token must not be empty")

	t.Logf("secret rotation verified: old rejected, new accepted")
}
