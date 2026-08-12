package platform

import (
	"context"
	"testing"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
	"github.com/stretchr/testify/require"
)

func TestGetRunnerBootstrapConfig_ReturnsConfiguredCoordinates(t *testing.T) {
	c := NewPlatformController("temporal.example:7233", "prod", nil)

	out, err := c.GetRunnerBootstrapConfig(context.Background(), &platformv1.GetRunnerBootstrapConfigInput{})

	require.NoError(t, err)
	require.Equal(t, "temporal.example:7233", out.GetTemporalAddress(),
		"runner bootstrap must echo the server's configured Temporal host:port")
	require.Equal(t, "prod", out.GetTemporalNamespace())
}

func TestGetRunnerBootstrapConfig_DefaultsFlowThrough(t *testing.T) {
	// The OSS server defaults TEMPORAL_HOST_PORT to localhost:7233 / default;
	// those defaults must reach an embedded runner verbatim so a no-config local
	// setup works without the runner hardcoding anything.
	c := NewPlatformController("localhost:7233", "default", nil)

	out, err := c.GetRunnerBootstrapConfig(context.Background(), &platformv1.GetRunnerBootstrapConfigInput{})

	require.NoError(t, err)
	require.Equal(t, "localhost:7233", out.GetTemporalAddress())
	require.Equal(t, "default", out.GetTemporalNamespace())
}
