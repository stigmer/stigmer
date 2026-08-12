package runnerauth

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	key := make([]byte, 32)
	copy(key, "0123456789abcdef0123456789abcdef")
	return NewService(key)
}

func TestMintVerify_RoundTrip(t *testing.T) {
	s := newTestService(t)

	token, expiresIn, err := s.Mint("wex_123", 0)
	require.NoError(t, err)
	assert.Equal(t, int64(DefaultTTL/time.Second), expiresIn)

	executionID, err := s.Verify(token)
	require.NoError(t, err)
	assert.Equal(t, "wex_123", executionID)
}

func TestMint_RequiresExecutionID(t *testing.T) {
	s := newTestService(t)

	_, _, err := s.Mint("", 0)
	require.Error(t, err)
}

func TestMint_DisabledWithoutKey(t *testing.T) {
	s := NewService(nil)

	_, _, err := s.Mint("wex_123", 0)
	require.ErrorIs(t, err, ErrMintingDisabled)
	assert.False(t, s.IsEnabled())
}

func TestVerify_FailsClosedWithoutKey(t *testing.T) {
	// A keyless service must reject even a well-formed token: without a key
	// no token can be authenticated as genuine.
	minter := newTestService(t)
	token, _, err := minter.Mint("wex_123", 0)
	require.NoError(t, err)

	keyless := NewService(nil)
	_, err = keyless.Verify(token)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerify_RejectsExpiredToken(t *testing.T) {
	s := newTestService(t)

	// Minimum representable positive TTL still yields exp in the future;
	// mint an already-expired token by hand instead, using the service's own
	// signer so only the expiry differs from a genuine token.
	claims, err := json.Marshal(tokenClaims{
		TokenType:   TokenTypeExecutionScoped,
		ExecutionID: "wex_123",
		IssuedAt:    time.Now().Add(-2 * time.Hour).Unix(),
		ExpiresAt:   time.Now().Add(-time.Hour).Unix(),
	})
	require.NoError(t, err)
	signingInput := jwtHeader + "." + base64.RawURLEncoding.EncodeToString(claims)
	expired := signingInput + "." + s.sign(signingInput)

	_, err = s.Verify(expired)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerify_RejectsTamperedPayload(t *testing.T) {
	s := newTestService(t)
	token, _, err := s.Mint("wex_123", 0)
	require.NoError(t, err)

	// Re-bind the payload to a different execution, keeping the signature.
	parts := strings.Split(token, ".")
	forged, err := json.Marshal(tokenClaims{
		TokenType:   TokenTypeExecutionScoped,
		ExecutionID: "wex_other",
		IssuedAt:    time.Now().Unix(),
		ExpiresAt:   time.Now().Add(time.Hour).Unix(),
	})
	require.NoError(t, err)
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString(forged) + "." + parts[2]

	_, err = s.Verify(tampered)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerify_RejectsWrongKey(t *testing.T) {
	s := newTestService(t)
	token, _, err := s.Mint("wex_123", 0)
	require.NoError(t, err)

	otherKey := make([]byte, 32)
	copy(otherKey, "ffffffffffffffffffffffffffffffff")
	other := NewService(otherKey)

	_, err = other.Verify(token)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerify_RejectsAlgConfusion(t *testing.T) {
	s := newTestService(t)

	// alg=none style header with an otherwise-plausible body must be refused
	// on the header pin alone.
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	claims, err := json.Marshal(tokenClaims{
		TokenType:   TokenTypeExecutionScoped,
		ExecutionID: "wex_123",
		IssuedAt:    time.Now().Unix(),
		ExpiresAt:   time.Now().Add(time.Hour).Unix(),
	})
	require.NoError(t, err)
	signingInput := header + "." + base64.RawURLEncoding.EncodeToString(claims)
	token := signingInput + "." + s.sign(signingInput)

	_, err = s.Verify(token)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerify_RejectsGarbage(t *testing.T) {
	s := newTestService(t)

	for _, token := range []string{"", "not-a-jwt", "a.b", "a.b.c.d", "a.!!!.c"} {
		_, err := s.Verify(token)
		assert.ErrorIs(t, err, ErrInvalidToken, "token %q", token)
	}
}

func TestToken_ParsesLikeTokenClaimsTS(t *testing.T) {
	// The runner inspects its own credentials with a naive split-and-decode
	// (token-claims.ts claimOf): three dot-separated parts, base64url JSON
	// payload, string token_type claim. Pin that wire compatibility.
	s := newTestService(t)
	token, _, err := s.Mint("aex_42", 0)
	require.NoError(t, err)

	parts := strings.Split(token, ".")
	require.Len(t, parts, 3)

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	require.NoError(t, err)

	var claims map[string]any
	require.NoError(t, json.Unmarshal(payload, &claims))
	assert.Equal(t, TokenTypeExecutionScoped, claims["token_type"])
	assert.Equal(t, "aex_42", claims["execution_id"])
}
