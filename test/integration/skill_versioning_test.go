//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Skill versioning is content-addressed: a version is the immutable SHA-256 of
// the artifact ZIP. The push RPC is exactly what `stigmer apply` /
// `stigmer seedpack apply` use to upload a skill directory, so these tests
// reproduce the seedpack flow against the real cloud (Java) server.
//
// The invariants asserted here:
//
//  1. Pushing distinct content accumulates versions, and the current (head)
//     version is always represented in the listing.
//  2. Re-pushing identical content preserves the head version_hash and keeps a
//     current version resolvable. (The exact dedup count for identical pushes is
//     a deliberate semantics decision tracked separately; this test captures the
//     observed count without over-constraining it.)

// pushSkillVersion pushes a skill whose slug is derived from name (stable across
// calls) and whose artifact content is driven by body (so distinct bodies yield
// distinct content hashes).
func pushSkillVersion(t *testing.T, ctx context.Context, clients *harness.Clients, name, body string) *skillv1.Skill {
	t.Helper()
	frontmatter := fmt.Sprintf("---\nname: %s\ndescription: Skill versioning integration test\n---\n\n", name)
	artifact, err := createSkillZip(frontmatter + body)
	require.NoError(t, err, "create skill ZIP should succeed")

	skill, err := clients.SkillCommand.Push(ctx, &skillv1.PushSkillRequest{
		Org:      harness.TestOrg,
		Artifact: artifact,
		Tag:      "latest",
	})
	require.NoError(t, err, "push skill should succeed")
	require.NotEmpty(t, skill.GetMetadata().GetId(), "push must assign an ID")
	return skill
}

func TestSkillVersioning_DistinctContentCreatesNewVersion(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	name := fmt.Sprintf("ver-skill-%s", uuid.New().String()[:8])

	// First push → version 1.
	skill1 := pushSkillVersion(t, ctx, clients, name, "# Skill v1\nOriginal body.\n")
	skillID := skill1.GetMetadata().GetId()
	org := skill1.GetMetadata().GetOrg()
	slug := skill1.GetMetadata().GetSlug()
	hash1 := skill1.GetStatus().GetVersionHash()
	require.NotEmpty(t, hash1, "push must assign a version hash to the head")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := clients.SkillCommand.Delete(cleanCtx, &skillv1.SkillId{Value: skillID}); err != nil {
			t.Logf("warning: failed to clean up skill %s: %v", skillID, err)
		}
	})

	list1, err := clients.SkillQuery.ListVersions(ctx, &skillv1.ListSkillVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err, "listVersions after first push should succeed")
	require.Len(t, list1.GetVersions(), 1, "exactly one version should exist after the first push")
	assert.True(t, list1.GetVersions()[0].GetIsCurrent(), "the sole version must be marked current")
	assert.Equal(t, hash1, list1.GetVersions()[0].GetVersionHash(), "listed version hash must match the head hash")

	// Second push with changed content → version 2.
	skill2 := pushSkillVersion(t, ctx, clients, name, "# Skill v2\nChanged body with new content.\n")
	require.Equal(t, skillID, skill2.GetMetadata().GetId(), "push must upsert by (org, slug), preserving the ID")
	hash2 := skill2.GetStatus().GetVersionHash()
	require.NotEmpty(t, hash2, "second push must assign a version hash to the head")
	require.NotEqual(t, hash1, hash2, "changed content must produce a different content hash")

	list2, err := clients.SkillQuery.ListVersions(ctx, &skillv1.ListSkillVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err, "listVersions after second push should succeed")
	require.GreaterOrEqual(t, len(list2.GetVersions()), 2, "at least two versions should exist after a distinct second push")

	// The current/head version must be present and marked current, and it must be
	// the newest entry (newest-first ordering).
	current := list2.GetVersions()[0]
	assert.True(t, current.GetIsCurrent(), "newest version must be current")
	assert.Equal(t, hash2, current.GetVersionHash(), "newest version must be the head (the just-pushed content)")

	// The older content hash must appear somewhere in the history.
	assert.True(t, containsSkillVersionHash(list2.GetVersions(), hash1),
		"older version hash must remain in the history after a new push")

	// GetByReference with no version pin resolves the current head.
	latest, err := clients.SkillQuery.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  org,
		Slug: slug,
		Kind: apiresourcekind.ApiResourceKind_skill,
	})
	require.NoError(t, err, "getByReference (latest) should succeed")
	assert.Equal(t, hash2, latest.GetStatus().GetVersionHash(), "latest must resolve to the newest version")

	t.Logf("skill versioning verified: id=%s, v1=%s, v2=%s, versions=%d",
		skillID, hash1[:12], hash2[:12], len(list2.GetVersions()))
}

func TestSkillVersioning_IdenticalPushPreservesHead(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	name := fmt.Sprintf("ver-skill-idem-%s", uuid.New().String()[:8])

	body := "# Skill\nStable body for idempotency.\n"
	skill1 := pushSkillVersion(t, ctx, clients, name, body)
	skillID := skill1.GetMetadata().GetId()
	org := skill1.GetMetadata().GetOrg()
	slug := skill1.GetMetadata().GetSlug()
	hash1 := skill1.GetStatus().GetVersionHash()
	require.NotEmpty(t, hash1, "push must assign a version hash")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := clients.SkillCommand.Delete(cleanCtx, &skillv1.SkillId{Value: skillID}); err != nil {
			t.Logf("warning: failed to clean up skill %s: %v", skillID, err)
		}
	})

	// Re-push byte-identical content.
	skill1b := pushSkillVersion(t, ctx, clients, name, body)
	require.Equal(t, skillID, skill1b.GetMetadata().GetId(), "identical re-push must upsert the same skill")
	assert.Equal(t, hash1, skill1b.GetStatus().GetVersionHash(),
		"identical re-push must preserve the head version_hash")

	list, err := clients.SkillQuery.ListVersions(ctx, &skillv1.ListSkillVersionsInput{Org: org, Slug: slug})
	require.NoError(t, err, "listVersions should succeed")
	require.Len(t, list.GetVersions(), 1,
		"identical re-push must be content-addressed: no duplicate version row")
	assert.Equal(t, int32(1), list.GetTotalCount(), "total_count should remain 1")
	assert.True(t, list.GetVersions()[0].GetIsCurrent(), "newest version must be current")
	assert.Equal(t, hash1, list.GetVersions()[0].GetVersionHash(), "current version hash must be unchanged")

	t.Logf("skill idempotent push verified: id=%s, hash=%s (1 version)", skillID, hash1[:12])
}

// containsSkillVersionHash reports whether any entry carries the given hash.
func containsSkillVersionHash(entries []*skillv1.SkillVersionEntry, hash string) bool {
	for _, e := range entries {
		if e.GetVersionHash() == hash {
			return true
		}
	}
	return false
}
