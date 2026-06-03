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

// TestMcpAudienceJWT_Accepted verifies that an Auth0-issued JWT scoped to the
// hosted MCP server's audience (aud = mcp.stigmer.ai) is accepted by the
// production security chain. The hosted MCP server forwards such tokens
// unchanged to stigmer-server, so the JwtTokenAudienceValidator must accept the
// MCP audience in addition to the primary API audience.
//
// The token reuses the bootstrap subject so it resolves to a known identity
// account, isolating the assertion to audience acceptance.
func TestMcpAudienceJWT_Accepted(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	token, err := mockAuth0.SignJWT(bootstrapIdpID, testMcpAudience, nil)
	require.NoError(t, err, "sign MCP-audience JWT")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	account, err := clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.NoError(t, err, "WhoAmI should succeed with a valid MCP-audience JWT")
	assert.Equal(t, bootstrapIdentityAccountID, account.GetMetadata().GetId(),
		"MCP-audience JWT should resolve to the bootstrap identity account")

	t.Logf("MCP-audience JWT accepted: identity=%s, aud=%s",
		account.GetMetadata().GetId(), testMcpAudience)
}

// TestMcpAudienceJWT_UnrelatedAudience_Rejected verifies that an Auth0-issued
// JWT whose audience matches neither the primary API audience nor the MCP
// audience is rejected. This guards against the audience list being widened
// into a blanket accept-any-audience check.
func TestMcpAudienceJWT_UnrelatedAudience_Rejected(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	token, err := mockAuth0.SignJWT(bootstrapIdpID, "https://unrelated-audience.example.com", nil)
	require.NoError(t, err, "sign JWT with unrelated audience")

	conn := grpcConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	clients := harness.NewClients(conn)

	_, err = clients.IdentityAccountQuery.WhoAmI(ctx, &emptypb.Empty{})
	require.Error(t, err, "WhoAmI should fail for an unrelated audience")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.Unauthenticated, st.Code(),
		"unrelated audience should return UNAUTHENTICATED, got %s: %s", st.Code(), st.Message())
}
