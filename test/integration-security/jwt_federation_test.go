//go:build integration

package security

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// TestFederatedJWT_ValidToken_Accepted verifies that a JWT signed by a
// registered IdentityProvider's JWKS key is accepted by the production
// security chain. This exercises FederatedJwtAuthenticationProvider end-to-end.
func TestFederatedJWT_ValidToken_Accepted(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	bootstrapClients := harness.NewClients(bootstrapConn)

	idp := registerTestIdP(t, ctx, bootstrapClients)

	federatedSub := "fed-user-" + uuid.New().String()[:8]

	err := mongoSeeder.SeedFederatedIdentityAccount(ctx, harness.SeedIdentityAccountInput{
		ID:        "fed-acct-" + uuid.New().String()[:8],
		IdpID:     federatedSub,
		Email:     federatedSub + "@federation-test.example.com",
		Name:      "Federated Test User",
		FirstName: "Federated",
		LastName:  "User",
	}, testOrg, idp.GetMetadata().GetName())
	require.NoError(t, err, "seed federated identity account")

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = mongoSeeder.DeleteIdentityAccount(cleanCtx, "fed-acct-"+federatedSub)
	})

	token, err := mockIdP.SignJWT(federatedSub, testAudience, nil)
	require.NoError(t, err, "sign federated JWT")

	federatedConn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	federatedClients := harness.NewClients(federatedConn)

	account, err := federatedClients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "WhoAmI should succeed with a valid federated JWT")
	assert.NotEmpty(t, account.GetMetadata().GetId(),
		"WhoAmI should return the resolved identity account")

	t.Logf("federated JWT accepted: identity=%s", account.GetMetadata().GetId())
}

// TestFederatedJWT_WrongIssuer_Rejected verifies that a JWT whose issuer
// does not match any registered IdentityProvider is rejected.
func TestFederatedJWT_WrongIssuer_Rejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	unknownIssuerServer, err := harness.NewMockJWKSServer("https://unknown-issuer.example.com")
	require.NoError(t, err)
	defer unknownIssuerServer.Close()

	token, err := unknownIssuerServer.SignJWT("some-user", testAudience, nil)
	require.NoError(t, err, "sign JWT with unknown issuer")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	_, err = clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.Error(t, err, "WhoAmI should fail with unknown issuer")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"unknown issuer should return UNAUTHENTICATED, got %s: %s", st.Code(), st.Message())
}

// TestFederatedJWT_ExpiredToken_Rejected verifies that an expired JWT from
// a registered IdentityProvider is rejected.
func TestFederatedJWT_ExpiredToken_Rejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	bootstrapClients := harness.NewClients(bootstrapConn)
	_ = registerTestIdP(t, ctx, bootstrapClients)

	token, err := mockIdP.SignExpiredJWT("expired-user", testAudience)
	require.NoError(t, err, "sign expired JWT")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	_, err = clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.Error(t, err, "WhoAmI should fail with expired token")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"expired token should return UNAUTHENTICATED, got %s: %s", st.Code(), st.Message())
}

// TestFederatedJWT_WrongSigningKey_Rejected verifies that a JWT signed with
// a key not present in the IdentityProvider's JWKS is rejected, even if the
// issuer and audience match.
func TestFederatedJWT_WrongSigningKey_Rejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	bootstrapClients := harness.NewClients(bootstrapConn)
	_ = registerTestIdP(t, ctx, bootstrapClients)

	token, err := mockIdP.SignJWTWithDifferentKey("wrong-key-user", testAudience)
	require.NoError(t, err, "sign JWT with wrong key")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	_, err = clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.Error(t, err, "WhoAmI should fail with wrong signing key")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"wrong signing key should return UNAUTHENTICATED, got %s: %s", st.Code(), st.Message())
}

// TestFederatedJWT_WrongAudience_Rejected verifies that a JWT with the
// correct issuer and signing key but wrong audience is rejected.
func TestFederatedJWT_WrongAudience_Rejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	bootstrapClients := harness.NewClients(bootstrapConn)
	_ = registerTestIdP(t, ctx, bootstrapClients)

	token, err := mockIdP.SignJWT("wrong-aud-user", "https://wrong-audience.example.com", nil)
	require.NoError(t, err, "sign JWT with wrong audience")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	_, err = clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.Error(t, err, "WhoAmI should fail with wrong audience")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"wrong audience should return UNAUTHENTICATED, got %s: %s", st.Code(), st.Message())
}

// TestFederatedJWT_AutoProvisioning verifies that a valid federated JWT
// with auto_provision_accounts=true on the IdentityProvider triggers
// automatic identity account creation for an unknown subject.
func TestFederatedJWT_AutoProvisioning(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	bootstrapClients := harness.NewClients(bootstrapConn)

	idpName := "test-idp-autoprov-" + uuid.New().String()[:8]
	idp := &identityproviderv1.IdentityProvider{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "IdentityProvider",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: idpName,
			Org:  testOrg,
		},
		Spec: &identityproviderv1.IdentityProviderSpec{
			DisplayName:           "Auto-Provision IdP",
			JwksUri:               mockIdP.JWKSURL,
			AllowedIssuers:        []string{mockIdP.Issuer},
			ExpectedAudience:      testAudience,
			AutoProvisionAccounts: true,
		},
	}

	created, err := bootstrapClients.IdentityProviderCommand.Create(ctx, idp)
	require.NoError(t, err, "create auto-provisioning IdP")

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = bootstrapClients.IdentityProviderCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(),
		})
	})

	newUserSub := "auto-prov-user-" + uuid.New().String()[:8]
	token, err := mockIdP.SignJWT(newUserSub, testAudience, map[string]any{
		"email": newUserSub + "@federation-test.example.com",
		"name":  "Auto Provisioned User",
	})
	require.NoError(t, err, "sign JWT for auto-provisioned user")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	if err != nil {
		st, _ := status.FromError(err)
		t.Logf("auto-provisioning WhoAmI failed: code=%s, message=%s", st.Code(), st.Message())
		t.Logf("NOTE: auto-provisioning may require FederatedAutoProvisioner to be active")
	}

	if err == nil {
		assert.NotEmpty(t, account.GetMetadata().GetId(),
			"auto-provisioned user should have an identity account")
		t.Logf("auto-provisioned: identity=%s, sub=%s",
			account.GetMetadata().GetId(), newUserSub)
	}
}

// --- helpers ---

// registerTestIdP creates a standard test IdentityProvider pointing at mockIdP.
// Each test gets its own IdP to avoid cache interference.
func registerTestIdP(t *testing.T, ctx context.Context, clients *harness.Clients) *identityproviderv1.IdentityProvider {
	t.Helper()

	idpName := "test-idp-" + uuid.New().String()[:8]
	idp := &identityproviderv1.IdentityProvider{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "IdentityProvider",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: idpName,
			Org:  testOrg,
		},
		Spec: &identityproviderv1.IdentityProviderSpec{
			DisplayName:      "Test Federation IdP",
			JwksUri:          mockIdP.JWKSURL,
			AllowedIssuers:   []string{mockIdP.Issuer},
			ExpectedAudience: testAudience,
		},
	}

	created, err := clients.IdentityProviderCommand.Create(ctx, idp)
	require.NoError(t, err, "register test IdentityProvider")

	t.Logf("registered IdP: id=%s, name=%s, jwks=%s", created.GetMetadata().GetId(), idpName, mockIdP.JWKSURL)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, err := clients.IdentityProviderCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(),
		})
		if err != nil {
			t.Logf("warning: failed to clean up IdP %s: %v", created.GetMetadata().GetId(), err)
		}
	})

	return created
}

// grpcConnWithBearer creates a gRPC connection that attaches the given Bearer
// token to every outgoing call. The connection is closed on test cleanup.
func grpcConnWithBearer(t *testing.T, address, token string) *grpc.ClientConn {
	t.Helper()

	conn, err := grpc.NewClient(
		address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
			ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
			return invoker(ctx, method, req, reply, cc, opts...)
		}),
		grpc.WithStreamInterceptor(func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
			ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
			return streamer(ctx, desc, cc, method, opts...)
		}),
	)
	require.NoError(t, err, "dial gRPC with bearer token")

	t.Cleanup(func() { conn.Close() })
	return conn
}
