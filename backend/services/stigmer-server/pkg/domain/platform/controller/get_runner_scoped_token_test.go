package platform

import (
	"context"
	"testing"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/runnerauth"
	"github.com/stretchr/testify/require"
)

// NOTE (oss#535): these tests previously pinned the opposite contract —
// "OSS must not mint scoped runner tokens" — which documented the
// pre-redaction world where EC reads returned plaintext and there was
// nothing to scope a token against. Since oss#535 the EC read RPCs redact
// by default and the minted token is the runner's decrypt lane, so the pin
// is deliberately reversed.

func newTestRunnerAuth(t *testing.T) *runnerauth.Service {
	t.Helper()
	key := make([]byte, 32)
	copy(key, "0123456789abcdef0123456789abcdef")
	return runnerauth.NewService(key)
}

func TestGetRunnerScopedToken_MintsForAgentExecution(t *testing.T) {
	auth := newTestRunnerAuth(t)
	c := NewPlatformController("localhost:7233", "default", auth)

	out, err := c.GetRunnerScopedToken(context.Background(), &platformv1.GetRunnerScopedTokenInput{
		Scope: &platformv1.GetRunnerScopedTokenInput_AgentExecutionId{AgentExecutionId: "aex_123"},
	})

	require.NoError(t, err)
	require.NotEmpty(t, out.GetRunnerScopedToken(), "OSS mints for the agent-execution arm (oss#535)")
	require.Equal(t, "Bearer", out.GetTokenType())
	require.Positive(t, out.GetExpiresInSeconds())

	// The token binds to exactly the execution named in the exchange.
	executionID, err := auth.Verify(out.GetRunnerScopedToken())
	require.NoError(t, err)
	require.Equal(t, "aex_123", executionID)
}

func TestGetRunnerScopedToken_MintsForWorkflowExecution(t *testing.T) {
	auth := newTestRunnerAuth(t)
	c := NewPlatformController("localhost:7233", "default", auth)

	out, err := c.GetRunnerScopedToken(context.Background(), &platformv1.GetRunnerScopedTokenInput{
		Scope: &platformv1.GetRunnerScopedTokenInput_WorkflowExecutionId{WorkflowExecutionId: "wex_456"},
	})

	require.NoError(t, err)
	require.NotEmpty(t, out.GetRunnerScopedToken(), "OSS mints for the workflow-execution arm (oss#535)")

	executionID, err := auth.Verify(out.GetRunnerScopedToken())
	require.NoError(t, err)
	require.Equal(t, "wex_456", executionID)
}

func TestGetRunnerScopedToken_PoolClaimNotMinted(t *testing.T) {
	// The pool_claim arm serves the cloud warm-pool attach. OSS has no pool,
	// so the arm keeps the presence-based "not minted" contract.
	c := NewPlatformController("localhost:7233", "default", newTestRunnerAuth(t))

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

func TestGetRunnerScopedToken_RenewalNotMinted(t *testing.T) {
	// OSS runners exchange immediately before each EC read, so there is no
	// long-lived credential to renew.
	c := NewPlatformController("localhost:7233", "default", newTestRunnerAuth(t))

	out, err := c.GetRunnerScopedToken(context.Background(), &platformv1.GetRunnerScopedTokenInput{
		Scope: &platformv1.GetRunnerScopedTokenInput_Renewal{
			Renewal: &platformv1.TokenRenewal{},
		},
	})

	require.NoError(t, err)
	require.Empty(t, out.GetRunnerScopedToken(), "OSS must not mint renewal tokens")
}

func TestGetRunnerScopedToken_NotMintedWithoutService(t *testing.T) {
	// A controller constructed without a minting service (or with a keyless
	// one) answers the presence-based "not minted" shape rather than an
	// error — the runner then reads tokenless and sees redacted values.
	for name, c := range map[string]*PlatformController{
		"nil service":     NewPlatformController("localhost:7233", "default", nil),
		"keyless service": NewPlatformController("localhost:7233", "default", runnerauth.NewService(nil)),
	} {
		out, err := c.GetRunnerScopedToken(context.Background(), &platformv1.GetRunnerScopedTokenInput{
			Scope: &platformv1.GetRunnerScopedTokenInput_AgentExecutionId{AgentExecutionId: "aex_123"},
		})

		require.NoError(t, err, name)
		require.Empty(t, out.GetRunnerScopedToken(), name)
		require.Zero(t, out.GetExpiresInSeconds(), name)
	}
}

func TestGetRunnerScopedToken_EmptyExecutionIdNotMinted(t *testing.T) {
	c := NewPlatformController("localhost:7233", "default", newTestRunnerAuth(t))

	out, err := c.GetRunnerScopedToken(context.Background(), &platformv1.GetRunnerScopedTokenInput{
		Scope: &platformv1.GetRunnerScopedTokenInput_AgentExecutionId{AgentExecutionId: ""},
	})

	require.NoError(t, err)
	require.Empty(t, out.GetRunnerScopedToken())
}
