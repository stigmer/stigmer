package platform

import (
	"context"
	"testing"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
	"github.com/stretchr/testify/require"
)

func TestGetRunnerScopedToken_ReturnsEmptyToken(t *testing.T) {
	// Scoped runner-token minting is cloud-only. OSS must answer with the
	// presence-based "not minted" shape (all token fields empty/zero) rather
	// than an error, so a runner that does call it falls back to its existing
	// credential instead of failing the execution.
	c := NewPlatformController("localhost:7233", "default")

	out, err := c.GetRunnerScopedToken(context.Background(), &platformv1.GetRunnerScopedTokenInput{
		Scope: &platformv1.GetRunnerScopedTokenInput_AgentExecutionId{AgentExecutionId: "aex_123"},
	})

	require.NoError(t, err)
	require.Empty(t, out.GetRunnerScopedToken(), "OSS must not mint scoped runner tokens")
	require.Empty(t, out.GetTokenType())
	require.Zero(t, out.GetExpiresInSeconds())
}

func TestGetRunnerScopedToken_PoolClaimAlsoReturnsEmptyToken(t *testing.T) {
	// The pool_claim arm serves the cloud warm-pool attach: a pool sandbox
	// exchanges its pool credential for a session token. OSS has no pool, so
	// the arm follows the same presence-based "not minted" contract as the
	// execution arms.
	c := NewPlatformController("localhost:7233", "default")

	out, err := c.GetRunnerScopedToken(context.Background(), &platformv1.GetRunnerScopedTokenInput{
		Scope: &platformv1.GetRunnerScopedTokenInput_PoolClaim{
			PoolClaim: &platformv1.PoolClaim{SessionId: "ses_123"},
		},
	})

	require.NoError(t, err)
	require.Empty(t, out.GetRunnerScopedToken(), "OSS must not mint pool-claim tokens")
	require.Empty(t, out.GetTokenType())
	require.Zero(t, out.GetExpiresInSeconds())
}
