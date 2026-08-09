package agentexecution

import (
	"context"
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// newUploadController wires a controller over a real local-filesystem artifact
// backend rooted at a temp dir, ready for UploadAttachment calls.
func newUploadController(t *testing.T) *AgentExecutionController {
	t.Helper()
	controller, store := setupTestController(t)
	t.Cleanup(func() { store.Close() })

	local, err := artifactstorage.NewLocalStorage(t.TempDir(), "http://localhost:7235")
	if err != nil {
		t.Fatalf("NewLocalStorage: %v", err)
	}
	controller.SetArtifactStorage(local)
	return controller
}

// TestUploadAttachment_RejectsTraversalFilenames proves the service boundary
// refuses a filename that would smuggle path separators or `..` segments into
// the storage key — the contract the proto comment states and buf.validate now
// enforces, backstopped here so a bypassed constraint still fails closed.
func TestUploadAttachment_RejectsTraversalFilenames(t *testing.T) {
	ctx := context.Background()
	controller := newUploadController(t)

	badFilenames := []string{
		"../evil.txt",
		"../../evil.txt",
		"a/b.txt",
		"dir/../../escape",
		"..",
		".",
		`..\evil.txt`,
		"sub\\file.txt",
	}

	for _, name := range badFilenames {
		t.Run(name, func(t *testing.T) {
			_, err := controller.UploadAttachment(ctx, &agentexecutionv1.UploadAttachmentRequest{
				Filename: name,
				Content:  []byte("payload"),
			})
			if err == nil {
				t.Fatalf("UploadAttachment(filename=%q) succeeded; expected InvalidArgument", name)
			}
			if got := status.Code(err); got != codes.InvalidArgument {
				t.Fatalf("UploadAttachment(filename=%q) code = %s; want InvalidArgument", name, got)
			}
		})
	}
}

// TestUploadAttachment_AcceptsPlainFilenames proves the guard does not over-
// reject: ordinary filenames (including dots inside the name, spaces, and
// unicode) still upload and produce the documented storage-key shape.
func TestUploadAttachment_AcceptsPlainFilenames(t *testing.T) {
	ctx := context.Background()
	controller := newUploadController(t)

	goodFilenames := []string{
		"dataset.csv",
		"report.final.v2.pdf",
		"my report.txt",
		"contrat-français.pdf",
	}

	for _, name := range goodFilenames {
		t.Run(name, func(t *testing.T) {
			resp, err := controller.UploadAttachment(ctx, &agentexecutionv1.UploadAttachmentRequest{
				Filename: name,
				Content:  []byte("payload"),
			})
			if err != nil {
				t.Fatalf("UploadAttachment(filename=%q) failed: %v", name, err)
			}
			if !strings.HasPrefix(resp.StorageKey, "attachments/") || !strings.HasSuffix(resp.StorageKey, "/"+name) {
				t.Fatalf("UploadAttachment(filename=%q) storage_key = %q; want attachments/{ulid}/%s", name, resp.StorageKey, name)
			}
		})
	}
}
