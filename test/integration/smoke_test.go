//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSmokeGRPCPipeline(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	t.Run("get non-existent workflow returns NOT_FOUND or descriptive error", func(t *testing.T) {
		client := workflowv1.NewWorkflowQueryControllerClient(grpcConn)
		_, err := client.Get(ctx, &workflowv1.WorkflowId{
			Value: "nonexistent-workflow-id",
		})

		require.Error(t, err, "should fail for non-existent workflow")
		st, ok := status.FromError(err)
		require.True(t, ok, "error should be a gRPC status")
		t.Logf("gRPC response code: %s, message: %s", st.Code(), st.Message())

		assert.NotEqual(t, codes.Unauthenticated, st.Code(),
			"should not get UNAUTHENTICATED — test security mode should bypass auth")
	})
}
