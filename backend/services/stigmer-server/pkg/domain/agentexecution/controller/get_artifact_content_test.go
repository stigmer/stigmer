package agentexecution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func sha256HexForTest(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// casBlobKeyFor builds a content-addressed CAS blob key for content — the exact
// shape the runner writes. When the stored bytes differ from content, the key's
// embedded address no longer matches the served bytes (the tamper case).
func casBlobKeyFor(executionID string, content []byte) string {
	return "artifacts/" + executionID + "/filereview/cas/blobs/" + sha256HexForTest(content)
}

// setupArtifactControllerWithExecution wires a controller over a real SQLite store
// and a real local-filesystem artifact backend, then seeds one execution so the
// existence load in GetArtifactContent succeeds.
func setupArtifactControllerWithExecution(t *testing.T, executionID string) *AgentExecutionController {
	t.Helper()
	controller, store := setupTestController(t)
	t.Cleanup(func() { store.Close() })

	local, err := artifactstorage.NewLocalStorage(t.TempDir(), "http://localhost:7235")
	if err != nil {
		t.Fatalf("failed to create local artifact storage: %v", err)
	}
	controller.SetArtifactStorage(local)

	exec := &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: executionID, Name: "artifact-test"},
	}
	if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent_execution, executionID, exec); err != nil {
		t.Fatalf("failed to seed execution: %v", err)
	}
	return controller
}

// TestGetArtifactContent_CasBlobIntegrity proves the serve-time content-address
// check on the real download path: a matching CAS blob is served, a tampered one
// fails closed with DATA_LOSS, the execution-scope guard still fires, the manifest
// is served unverified, and a truncated read is served without a false failure.
func TestGetArtifactContent_CasBlobIntegrity(t *testing.T) {
	const execID = "aex_artifact"
	ctx := context.Background()

	upload := func(t *testing.T, c *AgentExecutionController, key string, data []byte) {
		t.Helper()
		if err := c.artifactStorage.Upload(ctx, key, data, "application/octet-stream"); err != nil {
			t.Fatalf("upload %q failed: %v", key, err)
		}
	}

	t.Run("matching CAS blob is served", func(t *testing.T) {
		c := setupArtifactControllerWithExecution(t, execID)
		body := []byte("gitignored file bytes")
		key := casBlobKeyFor(execID, body)
		upload(t, c, key, body)

		resp, err := c.GetArtifactContent(ctx, &agentexecutionv1.GetArtifactContentRequest{
			ExecutionId: execID, StorageKey: key,
		})
		if err != nil {
			t.Fatalf("GetArtifactContent = %v, want nil", err)
		}
		if string(resp.Content) != string(body) {
			t.Fatalf("content = %q, want %q", resp.Content, body)
		}
		if resp.ContentType != "application/octet-stream" {
			t.Fatalf("content_type = %q, want application/octet-stream", resp.ContentType)
		}
	})

	t.Run("tampered CAS blob fails closed with DATA_LOSS", func(t *testing.T) {
		c := setupArtifactControllerWithExecution(t, execID)
		// Key addresses the hash of the original bytes; store different bytes there.
		key := casBlobKeyFor(execID, []byte("original bytes the runner captured"))
		upload(t, c, key, []byte("corrupted bytes"))

		_, err := c.GetArtifactContent(ctx, &agentexecutionv1.GetArtifactContentRequest{
			ExecutionId: execID, StorageKey: key,
		})
		if got := status.Code(err); got != codes.DataLoss {
			t.Fatalf("GetArtifactContent code = %v, want DataLoss (err=%v)", got, err)
		}
	})

	t.Run("CAS blob key of another execution is rejected", func(t *testing.T) {
		c := setupArtifactControllerWithExecution(t, execID)
		otherKey := casBlobKeyFor("aex_someone_else", []byte("x"))

		_, err := c.GetArtifactContent(ctx, &agentexecutionv1.GetArtifactContentRequest{
			ExecutionId: execID, StorageKey: otherKey,
		})
		if got := status.Code(err); got != codes.InvalidArgument {
			t.Fatalf("GetArtifactContent code = %v, want InvalidArgument (err=%v)", got, err)
		}
	})

	t.Run("manifest is served unverified", func(t *testing.T) {
		c := setupArtifactControllerWithExecution(t, execID)
		manifestKey := "artifacts/" + execID + "/filereview/cas/" + execID + "_0.manifest.json"
		manifest := []byte(`{"changeSetId":"` + execID + `:0","files":[]}`)
		upload(t, c, manifestKey, manifest)

		resp, err := c.GetArtifactContent(ctx, &agentexecutionv1.GetArtifactContentRequest{
			ExecutionId: execID, StorageKey: manifestKey,
		})
		if err != nil {
			t.Fatalf("GetArtifactContent(manifest) = %v, want nil", err)
		}
		if string(resp.Content) != string(manifest) {
			t.Fatalf("manifest content = %q, want %q", resp.Content, manifest)
		}
		if resp.ContentType != "application/json" {
			t.Fatalf("content_type = %q, want application/json", resp.ContentType)
		}
	})

	t.Run("blob exactly at max_bytes is verified", func(t *testing.T) {
		c := setupArtifactControllerWithExecution(t, execID)
		body := []byte("0123456789") // 10 bytes
		key := casBlobKeyFor(execID, body)
		upload(t, c, key, body)

		resp, err := c.GetArtifactContent(ctx, &agentexecutionv1.GetArtifactContentRequest{
			ExecutionId: execID, StorageKey: key, MaxBytes: int64(len(body)),
		})
		if err != nil {
			t.Fatalf("GetArtifactContent = %v, want nil", err)
		}
		if resp.Truncated {
			t.Fatalf("truncated = true, want false (object fits exactly)")
		}
	})

	t.Run("truncated read skips verification (no false DATA_LOSS)", func(t *testing.T) {
		c := setupArtifactControllerWithExecution(t, execID)
		// A tampered blob larger than max_bytes: because the read is partial we
		// cannot full-hash-verify, so it must be served (truncated), not rejected.
		key := casBlobKeyFor(execID, []byte("the original object bytes"))
		stored := []byte("corrupted but served because the read is truncated")
		upload(t, c, key, stored)

		resp, err := c.GetArtifactContent(ctx, &agentexecutionv1.GetArtifactContentRequest{
			ExecutionId: execID, StorageKey: key, MaxBytes: int64(len(stored) - 1),
		})
		if err != nil {
			t.Fatalf("GetArtifactContent = %v, want nil (truncated read must not verify)", err)
		}
		if !resp.Truncated {
			t.Fatalf("truncated = false, want true")
		}
	})
}
