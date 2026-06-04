//go:build integration

package security

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// TestStigmerJWT_MismatchedKey_Rejected reproduces the production incident:
// an iss="stigmer" token signed with a key the service does not hold fails
// signature verification, surfacing as UNAUTHENTICATED. This is the exact
// failure mode behind the "SHA256withRSA signature invalid" WARN — a token
// minted under a key the verifying pod never loaded.
func TestStigmerJWT_MismatchedKey_Rejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// A fresh, foreign key that is neither the primary nor the previous key.
	foreignKeyB64 := generateForeignSigningKey(t)

	token, err := harness.MintStigmerToken(foreignKeyB64, "stigmer-signing-key-1", bootstrapIdentityAccountID)
	require.NoError(t, err, "mint stigmer token with foreign key")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	_, err = clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.Error(t, err, "WhoAmI must fail for a token signed with an untrusted key")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"untrusted signing key should return UNAUTHENTICATED, got %s: %s", st.Code(), st.Message())

	t.Logf("foreign-key stigmer JWT rejected as expected: %s", st.Message())
}

// TestStigmerJWT_PreviousKey_Accepted proves the key-rotation overlap: a token
// signed with the previously-configured signing key (STIGMER_JWT_SIGNING_KEY_PREVIOUS)
// still verifies after the primary key has rotated, so in-flight tokens survive a
// rotation instead of being invalidated en masse.
func TestStigmerJWT_PreviousKey_Accepted(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Signed with the previous key, which the suite configured as the verify-only
	// overlap key. kid intentionally differs from the primary to mirror a clean
	// rotation; the verifier tries every configured key regardless.
	token, err := harness.MintStigmerToken(
		harness.StigmerPreviousJWTSigningKeyBase64,
		"stigmer-signing-key-0",
		bootstrapIdentityAccountID,
	)
	require.NoError(t, err, "mint stigmer token with previous key")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "WhoAmI should succeed with a token signed by the previous key")
	assert.Equal(t, bootstrapIdentityAccountID, account.GetMetadata().GetId(),
		"previous-key token should resolve to the bootstrap identity account")

	t.Logf("previous-key stigmer JWT accepted (rotation overlap): identity=%s",
		account.GetMetadata().GetId())
}

// TestStigmerJWT_PrimaryKey_Accepted is a control: the current primary signing
// key still mints tokens the service accepts, confirming the overlap did not
// break the active key.
func TestStigmerJWT_PrimaryKey_Accepted(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	token, err := harness.MintStigmerToken(
		harness.StigmerJWTSigningKeyBase64,
		"stigmer-signing-key-1",
		bootstrapIdentityAccountID,
	)
	require.NoError(t, err, "mint stigmer token with primary key")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "WhoAmI should succeed with a token signed by the primary key")
	assert.Equal(t, bootstrapIdentityAccountID, account.GetMetadata().GetId())
}

// generateForeignSigningKey returns a Base64-encoded PKCS#8 RSA private key that
// is independent of both the primary and previous keys the service trusts.
func generateForeignSigningKey(t *testing.T) string {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err, "generate foreign RSA key")

	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err, "marshal foreign key to PKCS#8")

	b64 := base64.StdEncoding.EncodeToString(der)
	// Sanity: must differ from the keys the service holds.
	require.False(t, strings.EqualFold(b64, harness.StigmerJWTSigningKeyBase64))
	require.False(t, strings.EqualFold(b64, harness.StigmerPreviousJWTSigningKeyBase64))
	return b64
}
