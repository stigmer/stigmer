package skill

import (
	"context"
	"sync"
	"testing"
	"time"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestIntegration_PushThenGet verifies the complete flow:
// Push a skill, then retrieve it by ID using Get.
func TestIntegration_PushThenGet(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push a skill
	skillContent := "# Integration Test Skill\n\nThis is a test."
	artifact := storage.CreateTestZip(skillContent)

	pushReq := &skillv1.PushSkillRequest{
		Name:     "Integration Test",
		Artifact: artifact,
		Tag:      "v1.0",
		Org:      "test-org",
	}
	pushed, err := controller.Push(contextWithSkillKind(), pushReq)
	require.NoError(t, err)

	// Get by ID
	getReq := &skillv1.SkillId{Value: pushed.Metadata.Id}
	retrieved, err := controller.Get(contextWithSkillKind(), getReq)
	require.NoError(t, err)

	// Verify all fields match
	assert.Equal(t, pushed.Metadata.Id, retrieved.Metadata.Id)
	assert.Equal(t, pushed.Metadata.Name, retrieved.Metadata.Name)
	assert.Equal(t, pushed.Metadata.Slug, retrieved.Metadata.Slug)
	assert.Equal(t, pushed.Metadata.Org, retrieved.Metadata.Org)
	assert.Equal(t, pushed.Spec.Tag, retrieved.Spec.Tag)
	assert.Equal(t, pushed.Spec.SkillMd, retrieved.Spec.SkillMd)
	assert.Equal(t, pushed.Status.VersionHash, retrieved.Status.VersionHash)
	assert.Equal(t, pushed.Status.ArtifactStorageKey, retrieved.Status.ArtifactStorageKey)
}

// TestIntegration_PushThenGetByReference verifies the complete flow:
// Push a skill, then retrieve it using GetByReference by slug.
func TestIntegration_PushThenGetByReference(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push a skill
	skillContent := "# Reference Test Skill"
	artifact := storage.CreateTestZip(skillContent)

	pushReq := &skillv1.PushSkillRequest{
		Name:     "Reference Test",
		Artifact: artifact,
	}
	pushed, err := controller.Push(contextWithSkillKind(), pushReq)
	require.NoError(t, err)

	// GetByReference using slug
	ref := &apiresourcepb.ApiResourceReference{
		Slug: pushed.Metadata.Slug,
		Kind: apiresourcekind.ApiResourceKind_skill,
	}
	retrieved, err := controller.GetByReference(contextWithSkillKind(), ref)
	require.NoError(t, err)

	// Verify match
	assert.Equal(t, pushed.Metadata.Id, retrieved.Metadata.Id)
	assert.Equal(t, pushed.Spec.SkillMd, retrieved.Spec.SkillMd)
}

// TestIntegration_PushThenGetArtifact verifies the complete flow:
// Push a skill, then download its artifact using GetArtifact.
func TestIntegration_PushThenGetArtifact(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push a skill
	skillContent := "# Artifact Test Skill"
	artifact := storage.CreateTestZip(skillContent)

	pushReq := &skillv1.PushSkillRequest{
		Name:     "Artifact Test",
		Artifact: artifact,
	}
	pushed, err := controller.Push(contextWithSkillKind(), pushReq)
	require.NoError(t, err)

	// GetArtifact using storage key
	artifactReq := &skillv1.GetArtifactRequest{
		ArtifactStorageKey: pushed.Status.ArtifactStorageKey,
	}
	artifactResp, err := controller.GetArtifact(contextWithSkillKind(), artifactReq)
	require.NoError(t, err)

	// Verify artifact matches original
	assert.Equal(t, artifact, artifactResp.Artifact)
}

// TestIntegration_VersionResolution_Latest verifies that GetByReference
// with "latest" version returns the most recent skill version.
func TestIntegration_VersionResolution_Latest(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push v1
	artifact1 := storage.CreateTestZip("# Calculator v1")
	req1 := &skillv1.PushSkillRequest{
		Name:     "Calculator",
		Artifact: artifact1,
		Tag:      "v1.0",
	}
	_, err := controller.Push(contextWithSkillKind(), req1)
	require.NoError(t, err)

	// Push v2 (update)
	artifact2 := storage.CreateTestZip("# Calculator v2 - Improved")
	req2 := &skillv1.PushSkillRequest{
		Name:     "Calculator",
		Artifact: artifact2,
		Tag:      "v2.0",
	}
	pushed2, err := controller.Push(contextWithSkillKind(), req2)
	require.NoError(t, err)

	// GetByReference with "latest" should return v2
	ref := &apiresourcepb.ApiResourceReference{
		Slug:    "calculator",
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Version: "latest",
	}
	retrieved, err := controller.GetByReference(contextWithSkillKind(), ref)
	require.NoError(t, err)

	assert.Equal(t, pushed2.Spec.Tag, retrieved.Spec.Tag)
	assert.Equal(t, "# Calculator v2 - Improved", retrieved.Spec.SkillMd)
}

// TestIntegration_VersionResolution_Tag verifies that GetByReference
// with a specific tag returns the matching version.
func TestIntegration_VersionResolution_Tag(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push with "stable" tag
	artifact := storage.CreateTestZip("# Stable Calculator")
	pushReq := &skillv1.PushSkillRequest{
		Name:     "Stable Calculator",
		Artifact: artifact,
		Tag:      "stable",
	}
	pushed, err := controller.Push(contextWithSkillKind(), pushReq)
	require.NoError(t, err)

	// GetByReference with version="stable"
	ref := &apiresourcepb.ApiResourceReference{
		Slug:    "stable-calculator",
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Version: "stable",
	}
	retrieved, err := controller.GetByReference(contextWithSkillKind(), ref)
	require.NoError(t, err)

	assert.Equal(t, pushed.Metadata.Id, retrieved.Metadata.Id)
	assert.Equal(t, "stable", retrieved.Spec.Tag)
}

// TestIntegration_VersionResolution_Hash verifies that GetByReference
// with an exact version hash returns the matching version.
func TestIntegration_VersionResolution_Hash(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push a skill
	artifact := storage.CreateTestZip("# Hash Test Skill")
	pushReq := &skillv1.PushSkillRequest{
		Name:     "Hash Test",
		Artifact: artifact,
	}
	pushed, err := controller.Push(contextWithSkillKind(), pushReq)
	require.NoError(t, err)

	// GetByReference with exact hash
	ref := &apiresourcepb.ApiResourceReference{
		Slug:    "hash-test",
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Version: pushed.Status.VersionHash,
	}
	retrieved, err := controller.GetByReference(contextWithSkillKind(), ref)
	require.NoError(t, err)

	assert.Equal(t, pushed.Metadata.Id, retrieved.Metadata.Id)
	assert.Equal(t, pushed.Status.VersionHash, retrieved.Status.VersionHash)
}

// TestIntegration_VersionHistory verifies that multiple versions of a skill
// can be pushed and are all retrievable by their respective hashes.
func TestIntegration_VersionHistory(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	versions := []struct {
		content string
		tag     string
	}{
		{"# Version 1.0", "v1.0"},
		{"# Version 2.0", "v2.0"},
		{"# Version 3.0", "v3.0"},
	}

	var pushedVersions []*skillv1.Skill

	// Push multiple versions
	for _, v := range versions {
		artifact := storage.CreateTestZip(v.content)
		pushReq := &skillv1.PushSkillRequest{
			Name:     "Multi Version",
			Artifact: artifact,
			Tag:      v.tag,
		}
		pushed, err := controller.Push(contextWithSkillKind(), pushReq)
		require.NoError(t, err)
		pushedVersions = append(pushedVersions, pushed)

		// Small delay to ensure different timestamps
		time.Sleep(5 * time.Millisecond)
	}

	// Verify latest returns the last version
	latestRef := &apiresourcepb.ApiResourceReference{
		Slug:    "multi-version",
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Version: "latest",
	}
	latest, err := controller.GetByReference(contextWithSkillKind(), latestRef)
	require.NoError(t, err)
	assert.Equal(t, "v3.0", latest.Spec.Tag)

	// Verify each version can be retrieved by hash (at least the current one)
	lastVersion := pushedVersions[len(pushedVersions)-1]
	hashRef := &apiresourcepb.ApiResourceReference{
		Slug:    "multi-version",
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Version: lastVersion.Status.VersionHash,
	}
	byHash, err := controller.GetByReference(contextWithSkillKind(), hashRef)
	require.NoError(t, err)
	assert.Equal(t, lastVersion.Status.VersionHash, byHash.Status.VersionHash)
}

// TestIntegration_UpdatePreservesAccess verifies that after updating a skill,
// the skill can still be accessed by ID, slug, and the new hash.
func TestIntegration_UpdatePreservesAccess(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push initial version
	artifact1 := storage.CreateTestZip("# Original Version")
	pushReq1 := &skillv1.PushSkillRequest{
		Name:     "Update Test",
		Artifact: artifact1,
		Tag:      "v1",
	}
	pushed1, err := controller.Push(contextWithSkillKind(), pushReq1)
	require.NoError(t, err)
	skillId := pushed1.Metadata.Id

	// Update to new version
	artifact2 := storage.CreateTestZip("# Updated Version")
	pushReq2 := &skillv1.PushSkillRequest{
		Name:     "Update Test",
		Artifact: artifact2,
		Tag:      "v2",
	}
	pushed2, err := controller.Push(contextWithSkillKind(), pushReq2)
	require.NoError(t, err)

	// Verify ID is preserved
	assert.Equal(t, skillId, pushed2.Metadata.Id)

	// Verify Get by ID works
	byId, err := controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: skillId})
	require.NoError(t, err)
	assert.Equal(t, "v2", byId.Spec.Tag)

	// Verify GetByReference by slug returns latest
	bySlug, err := controller.GetByReference(contextWithSkillKind(), &apiresourcepb.ApiResourceReference{
		Slug: "update-test",
		Kind: apiresourcekind.ApiResourceKind_skill,
	})
	require.NoError(t, err)
	assert.Equal(t, "v2", bySlug.Spec.Tag)

	// Verify new artifact is accessible
	artifactResp, err := controller.GetArtifact(contextWithSkillKind(), &skillv1.GetArtifactRequest{
		ArtifactStorageKey: pushed2.Status.ArtifactStorageKey,
	})
	require.NoError(t, err)
	assert.Equal(t, artifact2, artifactResp.Artifact)
}

// TestIntegration_DeleteCleansArtifacts verifies that deleting a skill
// removes it from the database (artifact cleanup is best-effort).
func TestIntegration_DeleteCleansArtifacts(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Push a skill
	artifact := storage.CreateTestZip("# Delete Test Skill")
	pushReq := &skillv1.PushSkillRequest{
		Name:     "Delete Test",
		Artifact: artifact,
	}
	pushed, err := controller.Push(contextWithSkillKind(), pushReq)
	require.NoError(t, err)

	// Verify skill exists
	_, err = controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: pushed.Metadata.Id})
	require.NoError(t, err)

	// Delete the skill
	_, err = controller.Delete(contextWithSkillKind(), &skillv1.SkillId{Value: pushed.Metadata.Id})
	require.NoError(t, err)

	// Verify skill is gone
	_, err = controller.Get(contextWithSkillKind(), &skillv1.SkillId{Value: pushed.Metadata.Id})
	require.Error(t, err, "skill should not exist after deletion")
}

// TestIntegration_ConcurrentPush verifies that concurrent push operations
// to different skills complete without errors or data corruption.
func TestIntegration_ConcurrentPush(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	const numGoroutines = 10
	var wg sync.WaitGroup
	errors := make(chan error, numGoroutines)

	// Push different skills concurrently
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			artifact := storage.CreateTestZip("# Concurrent Skill " + string(rune('A'+idx)))
			req := &skillv1.PushSkillRequest{
				Name:     "Concurrent Skill " + string(rune('A'+idx)),
				Artifact: artifact,
			}

			_, err := controller.Push(contextWithSkillKind(), req)
			if err != nil {
				errors <- err
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	// Check for errors
	for err := range errors {
		t.Errorf("concurrent push failed: %v", err)
	}

	// Verify all skills were created
	for i := 0; i < numGoroutines; i++ {
		slug := "concurrent-skill-" + string(rune('a'+i))
		ref := &apiresourcepb.ApiResourceReference{
			Slug: slug,
			Kind: apiresourcekind.ApiResourceKind_skill,
		}
		_, err := controller.GetByReference(contextWithSkillKind(), ref)
		assert.NoError(t, err, "skill %s should exist", slug)
	}
}

// TestIntegration_ConcurrentGet verifies that concurrent read operations
// on the same skill complete without errors.
func TestIntegration_ConcurrentGet(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Create a skill to read
	artifact := storage.CreateTestZip("# Concurrent Read Test")
	pushReq := &skillv1.PushSkillRequest{
		Name:     "Concurrent Read",
		Artifact: artifact,
	}
	pushed, err := controller.Push(contextWithSkillKind(), pushReq)
	require.NoError(t, err)

	const numGoroutines = 20
	var wg sync.WaitGroup
	errors := make(chan error, numGoroutines)
	results := make(chan *skillv1.Skill, numGoroutines)

	// Read the same skill concurrently
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			// Use a fresh context for each goroutine
			ctx := context.WithValue(context.Background(),
				contextKey("api_resource_kind"),
				apiresourcekind.ApiResourceKind_skill)

			retrieved, err := controller.Get(ctx, &skillv1.SkillId{Value: pushed.Metadata.Id})
			if err != nil {
				errors <- err
			} else {
				results <- retrieved
			}
		}()
	}

	wg.Wait()
	close(errors)
	close(results)

	// Check for errors
	for err := range errors {
		t.Errorf("concurrent get failed: %v", err)
	}

	// Verify all reads returned consistent data
	for result := range results {
		assert.Equal(t, pushed.Metadata.Id, result.Metadata.Id)
		assert.Equal(t, pushed.Spec.SkillMd, result.Spec.SkillMd)
	}
}

// contextKey is a type for context keys to avoid collisions
type contextKey string
