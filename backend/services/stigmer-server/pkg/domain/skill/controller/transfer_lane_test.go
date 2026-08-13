package skill

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/transfer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const testTransferBaseURL = "http://localhost:7234"

// withTransferLane equips a test controller with an upload-slot registry,
// mirroring the server wiring in pkg/server.
func withTransferLane(t *testing.T, c *SkillController) *transfer.UploadSlots {
	t.Helper()
	slots, err := transfer.NewUploadSlots(filepath.Join(t.TempDir(), "staging"), transfer.DefaultSlotTTL, storage.MaxZipSize)
	require.NoError(t, err)
	c.SetTransferLane(slots, testTransferBaseURL)
	return slots
}

// TestCreateArtifactUploadUrl_MintsCapability pins the mint contract: a
// valid size yields a URL under the configured base, a matching ref, and a
// positive TTL.
func TestCreateArtifactUploadUrl_MintsCapability(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()
	withTransferLane(t, controller)

	resp, err := controller.CreateArtifactUploadUrl(contextWithSkillKind(), &skillv1.CreateSkillArtifactUploadUrlRequest{
		Org:       "test-org",
		SizeBytes: 18 * 1024 * 1024, // the reporter's 18MB skill — over the gRPC cap, under the skill limit
	})
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(resp.Url, testTransferBaseURL+"/v1/skill-artifacts/uploads/"), "url = %s", resp.Url)
	assert.True(t, strings.HasSuffix(resp.Url, resp.ArtifactUploadRef), "url must embed the ref")
	assert.NotEmpty(t, resp.ArtifactUploadRef)
	assert.Positive(t, resp.TtlSeconds)
}

// TestCreateArtifactUploadUrl_FailsLoudOverLimit pins the fail-loud
// contract from #675: an over-limit declaration is refused BEFORE any bytes
// move, with the actual limit in the message — never a raw transport error.
func TestCreateArtifactUploadUrl_FailsLoudOverLimit(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()
	withTransferLane(t, controller)

	_, err := controller.CreateArtifactUploadUrl(contextWithSkillKind(), &skillv1.CreateSkillArtifactUploadUrlRequest{
		Org:       "test-org",
		SizeBytes: storage.MaxZipSize + 1,
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.InvalidArgument, st.Code())
	assert.Contains(t, st.Message(), "100MB", "the limit must be spelled out for the caller")
}

// TestCreateArtifactUploadUrl_UnconfiguredLane pins the degraded posture:
// without a transfer lane the RPC refuses with FAILED_PRECONDITION rather
// than minting URLs that dangle.
func TestCreateArtifactUploadUrl_UnconfiguredLane(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	_, err := controller.CreateArtifactUploadUrl(contextWithSkillKind(), &skillv1.CreateSkillArtifactUploadUrlRequest{
		Org:       "test-org",
		SizeBytes: 1024,
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
}

// TestPush_ByUploadRef pins the by-reference push end to end: staged bytes
// flow through the exact pipeline inline bytes do — same validation, same
// hash, same dedup — and the single-use ref dies with the push.
func TestPush_ByUploadRef(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()
	slots := withTransferLane(t, controller)

	skillContent := storage.ValidSkillContent("staged-skill", "# Staged\n\nPushed via the transfer lane.")
	artifact := storage.CreateTestZip(skillContent)

	// Mint + upload, as the HTTP handler would.
	ref, _, err := slots.Mint(int64(len(artifact)))
	require.NoError(t, err)
	require.NoError(t, slots.Receive(ref, bytes.NewReader(artifact)))

	result, err := controller.Push(contextWithSkillKind(), &skillv1.PushSkillRequest{
		Org:               "test-org",
		ArtifactUploadRef: ref,
	})
	require.NoError(t, err)

	assert.Equal(t, "staged-skill", result.Metadata.Name)
	assert.Equal(t, skillContent, result.Spec.SkillMd)
	assert.NotEmpty(t, result.Status.VersionHash)

	// The version hash is the content hash — identical to what an inline
	// push of the same bytes would produce (content addressing must not
	// care how the bytes traveled).
	assert.Equal(t, storage.CalculateHash(artifact), result.Status.VersionHash)

	// Single-use: replaying the ref fails loudly with the re-mint hint.
	_, err = controller.Push(contextWithSkillKind(), &skillv1.PushSkillRequest{
		Org:               "test-org",
		ArtifactUploadRef: ref,
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.InvalidArgument, st.Code())
	assert.Contains(t, st.Message(), "createArtifactUploadUrl")
}

// TestPush_ExactlyOneArtifactSource pins the proto contract: neither or
// both sources is refused by validation before the pipeline runs.
func TestPush_ExactlyOneArtifactSource(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()
	withTransferLane(t, controller)

	artifact := storage.CreateTestZip(storage.ValidSkillContent("dual", "# Dual"))

	// Neither source.
	_, err := controller.Push(contextWithSkillKind(), &skillv1.PushSkillRequest{Org: "test-org"})
	require.Error(t, err, "empty artifact source must be rejected")

	// Both sources.
	_, err = controller.Push(contextWithSkillKind(), &skillv1.PushSkillRequest{
		Org:               "test-org",
		Artifact:          artifact,
		ArtifactUploadRef: "sau_something",
	})
	require.Error(t, err, "dual artifact source must be rejected")
}

// TestPush_ByUploadRef_UnconfiguredLane pins that a ref-push against a
// server without the lane fails with FAILED_PRECONDITION, not a panic or a
// misleading validation error.
func TestPush_ByUploadRef_UnconfiguredLane(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	_, err := controller.Push(contextWithSkillKind(), &skillv1.PushSkillRequest{
		Org:               "test-org",
		ArtifactUploadRef: "sau_whatever",
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
}

// TestGetArtifactDownloadUrl pins the download twin: a pushed skill's
// storage key yields a URL under the base, the artifact's true size, and
// no expiry (the content-hash key is the non-expiring capability).
func TestGetArtifactDownloadUrl(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()
	withTransferLane(t, controller)

	artifact := storage.CreateTestZip(storage.ValidSkillContent("dl-skill", "# DL"))
	pushed, err := controller.Push(contextWithSkillKind(), &skillv1.PushSkillRequest{
		Org:      "test-org",
		Artifact: artifact,
	})
	require.NoError(t, err)

	resp, err := controller.GetArtifactDownloadUrl(contextWithSkillKind(), &skillv1.GetArtifactRequest{
		ArtifactStorageKey: pushed.Status.ArtifactStorageKey,
	})
	require.NoError(t, err)

	assert.Equal(t, testTransferBaseURL+"/v1/skill-artifacts/"+pushed.Status.ArtifactStorageKey, resp.Url)
	assert.Equal(t, int64(len(artifact)), resp.SizeBytes)
	assert.Zero(t, resp.TtlSeconds)
}

// TestGetArtifactDownloadUrl_NotFound pins that a dangling key fails at
// mint time with NotFound rather than at fetch time with a dead URL.
func TestGetArtifactDownloadUrl_NotFound(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()
	withTransferLane(t, controller)

	_, err := controller.GetArtifactDownloadUrl(contextWithSkillKind(), &skillv1.GetArtifactRequest{
		ArtifactStorageKey: "skills/0000000000000000000000000000000000000000000000000000000000000000.zip",
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.NotFound, st.Code())
}
