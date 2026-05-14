//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/health/grpc_health_v1"
)

func TestJavaServiceStarts(t *testing.T) {
	require.NotNil(t, testHarness, "suite harness must be initialized via TestMain")
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	t.Run("grpc health check", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		client := grpc_health_v1.NewHealthClient(grpcConn)
		resp, err := client.Check(ctx, &grpc_health_v1.HealthCheckRequest{})
		require.NoError(t, err, "health check should succeed")
		require.Equal(t, grpc_health_v1.HealthCheckResponse_SERVING, resp.GetStatus())
		t.Logf("gRPC health check: %s", resp.GetStatus())
	})
}
