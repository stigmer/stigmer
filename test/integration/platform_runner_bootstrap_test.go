//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
	"github.com/stretchr/testify/require"
)

// TestRunnerBootstrapConfig_ReturnsHarnessTemporalCoordinates proves the
// getRunnerBootstrapConfig RPC is wired end-to-end through the live service:
// an embedded runner that presents its token gets back the Temporal address it
// should dial.
//
// The harness configures the service with TEMPORAL_SERVICE_ADDRESS pointing at
// the ephemeral dev Temporal. No external-ingress override
// (STIGMER_RUNNER_BOOTSTRAP_TEMPORAL_ADDRESS) is set, so the handler falls back
// to the service's own connection target — which here IS the reachable address.
// Asserting equality therefore proves config -> handler -> RPC, and that the
// fallback path returns a usable coordinate rather than an empty string.
func TestRunnerBootstrapConfig_ReturnsHarnessTemporalCoordinates(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := platformv1.NewPlatformQueryControllerClient(grpcConn)

	out, err := client.GetRunnerBootstrapConfig(ctx, &platformv1.GetRunnerBootstrapConfigInput{})
	require.NoError(t, err, "getRunnerBootstrapConfig should succeed for an authenticated caller")

	expected := testHarness.Temporal.Address()
	require.Equal(t, expected, out.GetTemporalAddress(),
		"runner bootstrap must publish the Temporal address the service runs against; got %q want %q",
		out.GetTemporalAddress(), expected)
	require.NotEmpty(t, out.GetTemporalNamespace(),
		"runner bootstrap must publish a non-empty Temporal namespace")
}
