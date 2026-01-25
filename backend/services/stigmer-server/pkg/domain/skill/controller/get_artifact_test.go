package skill

import (
	"testing"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestGetArtifact_Success verifies that GetArtifact successfully retrieves
// a stored artifact by its storage key.
func TestGetArtifact_Success(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create and store a test artifact
	skillContent := "# Calculator Skill\n\nPerforms basic calculations."
	artifactData := storage.CreateTestZip(skillContent)
	artifactHash := storage.CalculateHash(artifactData)

	// Store the artifact using the storage interface
	storageKey, err := controller.artifactStorage.Store(artifactHash, artifactData)
	require.NoError(t, err)

	// Call GetArtifact
	req := &skillv1.GetArtifactRequest{
		ArtifactStorageKey: storageKey,
	}
	resp, err := controller.GetArtifact(contextWithSkillKind(), req)

	// Verify success
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, artifactData, resp.Artifact, "retrieved artifact should match stored data")
}

// TestGetArtifact_NotFound verifies that GetArtifact returns a NotFound error
// when the requested artifact doesn't exist.
func TestGetArtifact_NotFound(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Request a non-existent artifact
	req := &skillv1.GetArtifactRequest{
		ArtifactStorageKey: "skills/nonexistent1234567890abcdef1234567890abcdef1234567890abcdef1234567890.zip",
	}
	_, err := controller.GetArtifact(contextWithSkillKind(), req)

	// Verify NotFound status
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Contains(t, st.Message(), "not found")
}

// TestGetArtifact_EmptyStorageKey verifies that GetArtifact rejects requests
// with empty storage keys (proto validation).
func TestGetArtifact_EmptyStorageKey(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Request with empty storage key
	req := &skillv1.GetArtifactRequest{
		ArtifactStorageKey: "",
	}
	_, err := controller.GetArtifact(contextWithSkillKind(), req)

	// Verify validation error
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	assert.Equal(t, codes.InvalidArgument, st.Code())
}

// TestGetArtifact_InvalidStorageKey verifies that GetArtifact handles
// malformed storage keys appropriately.
func TestGetArtifact_InvalidStorageKey(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	testCases := []struct {
		name       string
		storageKey string
	}{
		{
			name:       "path traversal attempt",
			storageKey: "../../../etc/passwd",
		},
		{
			name:       "absolute path",
			storageKey: "/etc/passwd",
		},
		{
			name:       "malformed key",
			storageKey: "invalid-key-format",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &skillv1.GetArtifactRequest{
				ArtifactStorageKey: tc.storageKey,
			}
			_, err := controller.GetArtifact(contextWithSkillKind(), req)

			// Should return an error (either NotFound or Internal)
			require.Error(t, err)
			st, ok := status.FromError(err)
			require.True(t, ok, "error should be a gRPC status")
			// Accept either NotFound or Internal error codes
			assert.Contains(t, []codes.Code{codes.NotFound, codes.Internal}, st.Code())
		})
	}
}

// TestGetArtifact_LargeArtifact verifies that GetArtifact can handle
// large artifacts (up to practical limits) without issues.
func TestGetArtifact_LargeArtifact(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping large artifact test in short mode")
	}

	controller, store := setupTestController(t)
	defer store.Close()

	// Create a large artifact (~10MB with SKILL.md + additional files)
	largeSkillContent := "# Large Skill\n\n" + string(make([]byte, 1024*1024)) // 1MB SKILL.md
	files := map[string][]byte{
		"SKILL.md": []byte(largeSkillContent),
	}

	// Add several large files to the ZIP
	for i := 0; i < 9; i++ {
		filename := "data_" + string(rune('0'+i)) + ".bin"
		files[filename] = make([]byte, 1024*1024) // 1MB each
	}

	artifactData := storage.CreateTestZipWithFiles(files)
	artifactHash := storage.CalculateHash(artifactData)

	// Store the large artifact
	storageKey, err := controller.artifactStorage.Store(artifactHash, artifactData)
	require.NoError(t, err)

	// Retrieve the large artifact
	req := &skillv1.GetArtifactRequest{
		ArtifactStorageKey: storageKey,
	}
	resp, err := controller.GetArtifact(contextWithSkillKind(), req)

	// Verify success and data integrity
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, len(artifactData), len(resp.Artifact), "artifact size should match")
	assert.Equal(t, artifactData, resp.Artifact, "artifact content should match exactly")
}
