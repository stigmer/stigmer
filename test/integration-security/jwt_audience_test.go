//go:build integration

package security

import (
	"context"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// TestStigmerJWT_ForeignAudience_Rejected reproduces the production incident's true
// root cause: cross-environment token bleed. A token carries iss="stigmer" and the
// shared constant kid ("stigmer-signing-key-1") — identical to a real token — but is
// signed by a key this environment does not hold and is stamped with another
// environment's audience. The service must reject it as UNAUTHENTICATED. The
// verifier classifies it as a misrouted foreign token (logged calmly) rather than a
// raw SHA256withRSA signature alarm.
func TestStigmerJWT_ForeignAudience_Rejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// A key the service does not trust, mirroring a different environment minting
	// tokens that happen to reuse the shared iss/kid constants.
	foreignKeyB64 := generateForeignSigningKey(t)

	token, err := harness.MintStigmerTokenWithAudience(
		foreignKeyB64,
		"stigmer-signing-key-1", // the same constant kid the real prod key uses
		bootstrapIdentityAccountID,
		"https://api.other-environment.example", // not this environment's audience
	)
	require.NoError(t, err, "mint foreign-environment stigmer token")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	_, err = clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.Error(t, err, "WhoAmI must fail for a token minted by another environment")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"cross-environment token should return UNAUTHENTICATED, got %s: %s", st.Code(), st.Message())

	t.Logf("foreign-environment stigmer JWT rejected as expected: %s", st.Message())
}

// TestStigmerJWT_PrimaryKeyMatchingAudience_Accepted is the positive control: a
// token signed by the environment's primary key and stamped with this
// environment's audience verifies and resolves to the bootstrap identity.
func TestStigmerJWT_PrimaryKeyMatchingAudience_Accepted(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	token, err := harness.MintStigmerTokenWithAudience(
		harness.StigmerJWTSigningKeyBase64,
		"stigmer-signing-key-1",
		bootstrapIdentityAccountID,
		harness.StigmerJWTAudience,
	)
	require.NoError(t, err, "mint primary-key token with matching audience")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "WhoAmI should succeed with a primary-key token carrying the matching audience")
	assert.Equal(t, bootstrapIdentityAccountID, account.GetMetadata().GetId())
}

// TestStigmerJWT_PrimaryKeyNoAudience_AcceptedLenient pins the lenient-mode
// migration guarantee: a token signed by the primary key but carrying no audience
// (a pre-change token) still verifies while STIGMER_JWT_REQUIRE_AUDIENCE is false.
func TestStigmerJWT_PrimaryKeyNoAudience_AcceptedLenient(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	token, err := harness.MintStigmerToken(
		harness.StigmerJWTSigningKeyBase64,
		"stigmer-signing-key-1",
		bootstrapIdentityAccountID,
	)
	require.NoError(t, err, "mint primary-key token without audience")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "WhoAmI should succeed for a no-audience token in lenient mode")
	assert.Equal(t, bootstrapIdentityAccountID, account.GetMetadata().GetId())
}
