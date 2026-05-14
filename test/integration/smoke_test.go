//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

// TestSmokeGRPCPipeline proves the full gRPC pipeline through the Java
// service works: Go client → gRPC → Spring Boot handler → MongoDB → response.
func TestSmokeGRPCPipeline(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping smoke test in short mode")
	}

	jarPath := findFatJar()
	if jarPath == "" {
		t.Skip("stigmer-service fat JAR not found — set STIGMER_SERVICE_JAR or build with bazel")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	h, err := harness.Start(ctx, harness.DefaultConfig())
	require.NoError(t, err)
	defer h.Stop(ctx)

	svc, err := harness.StartJavaService(ctx, harness.ServiceConfig{
		JarPath:         jarPath,
		MongoHost:       h.Mongo.Host,
		MongoPort:       h.Mongo.Port,
		RedisHost:       h.Redis.Host,
		RedisPort:       h.Redis.Port,
		TemporalAddress: h.Temporal.Address(),
	}, nil)
	require.NoError(t, err)
	h.Service = svc

	conn, err := grpc.NewClient(
		svc.GRPCAddress(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	defer conn.Close()

	t.Run("get non-existent workflow returns NOT_FOUND or descriptive error", func(t *testing.T) {
		client := workflowv1.NewWorkflowQueryControllerClient(conn)
		_, err := client.Get(ctx, &workflowv1.WorkflowId{
			Value: "nonexistent-workflow-id",
		})

		require.Error(t, err, "should fail for non-existent workflow")
		st, ok := status.FromError(err)
		require.True(t, ok, "error should be a gRPC status")
		t.Logf("gRPC response code: %s, message: %s", st.Code(), st.Message())

		// Accept NOT_FOUND (clean path) or other expected error codes.
		// UNAUTHENTICATED would indicate auth bypass isn't working.
		assert.NotEqual(t, codes.Unauthenticated, st.Code(),
			"should not get UNAUTHENTICATED — test security mode should bypass auth")
	})
}
