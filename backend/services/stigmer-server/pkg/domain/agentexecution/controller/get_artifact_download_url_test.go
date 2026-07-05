package agentexecution

import (
	"context"
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// TestGetArtifactDownloadUrl_Attachment proves the as_attachment flag flows
// into the signed URL: with the local backend, an attachment request appends a
// download query param naming the artifact (the storage key's basename), while
// an inline request (the default) does not. This is the server half of the
// "downloads actually save a file" contract — the presigned URL carries the
// disposition because browsers ignore the HTML download attribute cross-origin.
func TestGetArtifactDownloadUrl_Attachment(t *testing.T) {
	const execID = "aex_download"
	ctx := context.Background()
	c := setupArtifactControllerWithExecution(t, execID)

	key := "artifacts/" + execID + "/plan_card_ux_cleanup.plan.md"

	t.Run("inline by default (no disposition)", func(t *testing.T) {
		resp, err := c.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
			ExecutionId: execID, StorageKey: key,
		})
		if err != nil {
			t.Fatalf("GetArtifactDownloadUrl = %v, want nil", err)
		}
		if strings.Contains(resp.DownloadUrl, "download=") {
			t.Fatalf("inline URL unexpectedly carries a download disposition: %q", resp.DownloadUrl)
		}
	})

	t.Run("as_attachment names the download after the artifact", func(t *testing.T) {
		resp, err := c.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
			ExecutionId: execID, StorageKey: key, AsAttachment: true,
		})
		if err != nil {
			t.Fatalf("GetArtifactDownloadUrl = %v, want nil", err)
		}
		if !strings.Contains(resp.DownloadUrl, "download=plan_card_ux_cleanup.plan.md") {
			t.Fatalf("attachment URL missing basename disposition: %q", resp.DownloadUrl)
		}
	})
}
