package agentexecution

import (
	"context"
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

// setupArtifactControllerWithSpecAttachment mirrors
// setupArtifactControllerWithExecution but seeds the execution with
// spec.attachments referencing attachmentKey — the record shape the key check's
// attachment arm reads.
func setupArtifactControllerWithSpecAttachment(t *testing.T, executionID, attachmentKey string) *AgentExecutionController {
	t.Helper()
	controller, store := setupTestController(t)
	t.Cleanup(func() { store.Close() })

	local, err := artifactstorage.NewLocalStorage(t.TempDir(), "http://localhost:7235")
	if err != nil {
		t.Fatalf("failed to create local artifact storage: %v", err)
	}
	controller.SetArtifactStorage(local)

	exec := &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: executionID, Name: "attachment-test"},
		Spec: &agentexecutionv1.AgentExecutionSpec{
			Attachments: []*agentexecutionv1.Attachment{
				{Filename: "notes.png", StorageKey: attachmentKey, ContentType: "image/png"},
			},
		},
	}
	if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent_execution, executionID, exec); err != nil {
		t.Fatalf("failed to seed execution: %v", err)
	}
	return controller
}

// TestGetArtifactDownloadUrl_SpecAttachmentKey proves the key check's two
// acceptance arms and its rejection: an "attachments/{ulid}/..." key presigns
// when (and only when) the execution's spec.attachments lists it verbatim.
// This is the server half of rendering submitted attachments in the message
// thread (stigmer/stigmer#372) — attachment keys carry no execution id, so
// ownership is the spec reference, not the key's shape.
func TestGetArtifactDownloadUrl_SpecAttachmentKey(t *testing.T) {
	const execID = "aex_attach_presign"
	attachmentKey := "attachments/01JXULIDULIDULIDULIDULIDXX/notes.png"
	ctx := context.Background()
	c := setupArtifactControllerWithSpecAttachment(t, execID, attachmentKey)

	t.Run("key listed in spec.attachments is accepted", func(t *testing.T) {
		resp, err := c.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
			ExecutionId: execID, StorageKey: attachmentKey,
		})
		if err != nil {
			t.Fatalf("GetArtifactDownloadUrl = %v, want nil", err)
		}
		if resp.DownloadUrl == "" {
			t.Fatal("DownloadUrl is empty, want a presigned URL")
		}
	})

	t.Run("as_attachment names the download after the attachment file", func(t *testing.T) {
		resp, err := c.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
			ExecutionId: execID, StorageKey: attachmentKey, AsAttachment: true,
		})
		if err != nil {
			t.Fatalf("GetArtifactDownloadUrl = %v, want nil", err)
		}
		if !strings.Contains(resp.DownloadUrl, "download=notes.png") {
			t.Fatalf("attachment URL missing basename disposition: %q", resp.DownloadUrl)
		}
	})

	t.Run("artifact-prefixed key still accepted alongside attachments", func(t *testing.T) {
		resp, err := c.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
			ExecutionId: execID, StorageKey: "artifacts/" + execID + "/report.md",
		})
		if err != nil {
			t.Fatalf("GetArtifactDownloadUrl = %v, want nil", err)
		}
		if resp.DownloadUrl == "" {
			t.Fatal("DownloadUrl is empty, want a presigned URL")
		}
	})

	t.Run("attachment key not in spec is rejected", func(t *testing.T) {
		_, err := c.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
			ExecutionId: execID, StorageKey: "attachments/01JXOTHERULIDULIDULIDULIDX/other.png",
		})
		if got := status.Code(err); got != codes.InvalidArgument {
			t.Fatalf("GetArtifactDownloadUrl code = %v, want InvalidArgument (err=%v)", got, err)
		}
	})

	t.Run("execution without the spec entry rejects the same key", func(t *testing.T) {
		// A second execution that never referenced attachmentKey must not be
		// able to presign it — membership is per-execution, not global.
		other := setupArtifactControllerWithExecution(t, "aex_other")
		_, err := other.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
			ExecutionId: "aex_other", StorageKey: attachmentKey,
		})
		if got := status.Code(err); got != codes.InvalidArgument {
			t.Fatalf("GetArtifactDownloadUrl code = %v, want InvalidArgument (err=%v)", got, err)
		}
	})
}
