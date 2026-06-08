//go:build integration

package security

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/emptypb"
)

// TestRunnerBootstrapToken_MintAndUse verifies the embedded-runner token
// exchange through the production security chain:
//
//  1. An authenticated caller (here a mock-Auth0 first-party user) calls
//     getRunnerBootstrapConfig.
//  2. The control plane returns the Temporal coordinates AND mints an
//     iss=stigmer runner access token bound to the caller's identity account.
//  3. That minted token authenticates against a protected endpoint via the same
//     PlatformClientTokenAuthenticationProvider the Cursor BiDi proxy uses,
//     resolving back to the original caller's identity.
//
// This is the exchange the desktop relies on (it presents an Auth0 token it
// cannot use for x-stigmer-auth and receives a token it can). The existing
// harness MintRunnerToken path proves an iss=stigmer token meters on
// /agent.v1.*; this test proves the server actually produces such a token from
// a first-party caller.
func TestRunnerBootstrapToken_MintAndUse(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	platformQuery := platformv1.NewPlatformQueryControllerClient(bootstrapConn)

	resp, err := platformQuery.GetRunnerBootstrapConfig(ctx, &platformv1.GetRunnerBootstrapConfigInput{})
	require.NoError(t, err, "getRunnerBootstrapConfig should succeed for an authenticated caller")

	// Coordinates are load-bearing and must always be present.
	require.NotEmpty(t, resp.GetTemporalAddress(), "temporal address must be returned")
	require.NotEmpty(t, resp.GetTemporalNamespace(), "temporal namespace must be returned")

	// The cloud service has a signing key configured in this suite, so it must
	// mint a runner access token.
	mintedToken := resp.GetRunnerAccessToken()
	require.NotEmpty(t, mintedToken, "a runner access token must be minted by the cloud service")
	assert.Equal(t, "Bearer", resp.GetTokenType(), "token_type must be Bearer when a token is present")
	assert.Greater(t, resp.GetRunnerAccessTokenExpiresInSeconds(), int32(0),
		"expires_in must be positive so the runner can schedule a refresh")

	// The token must be a well-formed JWT carrying the expected runner claims.
	claims := decodeJWTClaims(t, mintedToken)
	assert.Equal(t, "stigmer", claims["iss"], "minted runner token must be Stigmer-issued")
	assert.Equal(t, bootstrapIdentityAccountID, claims["sub"],
		"minted token subject must be the caller's identity account")
	assert.Equal(t, "embedded_runner", claims["token_type"],
		"minted token must be marked as an embedded_runner token")
	_, hasOrg := claims["org"]
	assert.False(t, hasOrg, "embedded runner tokens must not carry an org claim")

	// The minted token must authenticate against the production auth chain — the
	// same PlatformClientTokenAuthenticationProvider the BiDi proxy uses — and
	// resolve back to the original caller's identity.
	runnerConn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), mintedToken)
	runnerClients := harness.NewClients(runnerConn)

	whoAmI, err := runnerClients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "the minted runner token must authenticate on a protected endpoint")
	assert.Equal(t, bootstrapIdentityAccountID, whoAmI.GetMetadata().GetId(),
		"the minted token must resolve to the same identity account that requested it")

	t.Logf("runner bootstrap token minted and accepted: expires_in=%d, identity=%s",
		resp.GetRunnerAccessTokenExpiresInSeconds(), whoAmI.GetMetadata().GetId())
}

// decodeJWTClaims base64url-decodes a JWT payload and returns its claims. It does
// not verify the signature — the subsequent authenticated call is what proves the
// signature is valid; this only asserts the claim shape.
func decodeJWTClaims(t *testing.T, token string) map[string]any {
	t.Helper()
	parts := strings.Split(token, ".")
	require.Len(t, parts, 3, "minted token should be a well-formed JWT (header.payload.signature)")

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	require.NoError(t, err, "JWT payload should be valid base64url")

	var claims map[string]any
	require.NoError(t, json.Unmarshal(payload, &claims), "JWT payload should be valid JSON")
	return claims
}
