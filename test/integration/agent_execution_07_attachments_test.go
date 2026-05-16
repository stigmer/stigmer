//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

func TestAgentExecution_Attachment_Upload(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			// Probe R2 availability: if upload fails with connection refused,
			// the artifact storage backend is not available in this test environment.
			uploadResp, err := clients.AgentExecutionCommand.UploadAttachment(ctx,
				&agentexecv1.UploadAttachmentRequest{
					Filename:    "test-data.txt",
					Content:     []byte("This is test data for the agent to process."),
					ContentType: "text/plain",
				})
			if err != nil && strings.Contains(err.Error(), "Connection refused") {
				t.Skip("R2 storage not available — skipping attachment test")
			}
			require.NoError(t, err, "upload attachment should succeed")
			require.NotEmpty(t, uploadResp.GetStorageKey(), "upload should return a storage key")

			t.Logf("uploaded attachment: storage_key=%s", uploadResp.GetStorageKey())

			agent := harness.CreateAgent(t, ctx, clients, "test-attach-"+h.Name,
				"You are a helpful assistant. When given a file, read it and describe its contents briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Read the attached file and tell me what it contains.",
				func(s *agentexecv1.AgentExecutionSpec) {
					s.Attachments = []*agentexecv1.Attachment{
						{
							Filename:   "test-data.txt",
							StorageKey: uploadResp.GetStorageKey(),
						},
					}
				},
			)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			t.Logf("attachment test completed: id=%s, messages=%d",
				result.GetMetadata().GetId(),
				len(result.GetStatus().GetMessages()))
		})
	}
}
