//go:build integration

package integration

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health/grpc_health_v1"
)

func findFatJar() string {
	if jar := os.Getenv("STIGMER_SERVICE_JAR"); jar != "" {
		return jar
	}

	// Default: relative path from stigmer repo to stigmer-cloud bazel-bin
	candidates := []string{
		"../../../../stigmer-cloud/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			return abs
		}
	}
	return ""
}

func TestJavaServiceStarts(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping service test in short mode")
	}

	jarPath := findFatJar()
	if jarPath == "" {
		t.Skip("stigmer-service fat JAR not found — set STIGMER_SERVICE_JAR or build with bazel")
	}
	t.Logf("using fat JAR: %s", jarPath)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	h, err := harness.Start(ctx, harness.DefaultConfig())
	require.NoError(t, err, "test harness infrastructure should start")
	defer h.Stop(ctx)

	svcCfg := harness.ServiceConfig{
		JarPath:         jarPath,
		MongoHost:       h.Mongo.Host,
		MongoPort:       h.Mongo.Port,
		RedisHost:       h.Redis.Host,
		RedisPort:       h.Redis.Port,
		TemporalAddress: h.Temporal.Address(),
	}

	svc, err := harness.StartJavaService(ctx, svcCfg, nil)
	require.NoError(t, err, "java service should start in test mode")
	h.Service = svc

	t.Run("grpc health check", func(t *testing.T) {
		conn, err := grpc.NewClient(
			svc.GRPCAddress(),
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
		require.NoError(t, err, "should connect to gRPC server")
		defer conn.Close()

		client := grpc_health_v1.NewHealthClient(conn)
		resp, err := client.Check(ctx, &grpc_health_v1.HealthCheckRequest{})
		require.NoError(t, err, "health check should succeed")
		require.Equal(t, grpc_health_v1.HealthCheckResponse_SERVING, resp.GetStatus())
		t.Logf("gRPC health check: %s", resp.GetStatus())
	})
}
