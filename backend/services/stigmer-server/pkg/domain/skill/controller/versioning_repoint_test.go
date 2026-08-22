package skill

import (
	"testing"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// These tests pin the content-addressed version identity contract for skills
// (stigmer/stigmer#475 — the model workflows adopted in #341):
//
//   - one content, one history row: re-pushing already-archived content
//     repoints the head instead of inserting a duplicate (the A→B→A case);
//   - the audit tag column is the tag's only home, single-holder: a tag names
//     exactly one version, moving off its prior holder on every assignment;
//   - is_current follows the live head hash, not row recency — under repoint
//     the current version need not be the newest-archived row.

// pushSkillArtifact pushes a skill built from the given body under the given
// tag and returns the resulting skill.
func pushSkillArtifact(t *testing.T, controller *SkillController, name, body, tag string) *skillv1.Skill {
	t.Helper()
	content := storage.ValidSkillContent(name, body)
	result, err := controller.Push(contextWithSkillKind(), &skillv1.PushSkillRequest{
		Artifact: storage.CreateTestZip(content),
		Tag:      tag,
		Org:      "test-org",
	})
	require.NoError(t, err)
	return result
}

type skillVersionExpectation struct {
	hash      string
	tag       string
	isCurrent bool
}

// assertSkillVersionHistory asserts the exact newest-first version history,
// each entry's column-derived tag, and that exactly one entry is current.
func assertSkillVersionHistory(t *testing.T, controller *SkillController, slug string, want []skillVersionExpectation) {
	t.Helper()

	resp, err := controller.ListVersions(contextWithSkillKind(), &skillv1.ListSkillVersionsInput{
		Org:  "test-org",
		Slug: slug,
	})
	require.NoError(t, err)
	require.Len(t, resp.Versions, len(want), "version history row count")

	currentCount := 0
	for i, entry := range resp.Versions {
		assert.Equal(t, want[i].hash, entry.VersionHash, "versions[%d].version_hash", i)
		assert.Equal(t, want[i].tag, entry.Tag, "versions[%d].tag", i)
		assert.Equal(t, want[i].isCurrent, entry.IsCurrent, "versions[%d].is_current", i)
		if entry.IsCurrent {
			currentCount++
		}
	}
	assert.Equal(t, 1, currentCount, "exactly one version must be current")
}

// TestSkillVersioning_RepushRepointsHead pins the A→B→A contract end to end:
// re-pushing prior content reproduces its hash (the hash is the SHA-256 of
// the artifact), the head repoints to the existing audit row without a
// duplicate, the single-holder tag follows the head, and is_current lands on
// the repointed-to (older) row.
func TestSkillVersioning_RepushRepointsHead(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	atA := pushSkillArtifact(t, controller, "repoint-skill", "# Body A", "stable")
	hashA := atA.GetStatus().GetVersionHash()
	require.NotEmpty(t, hashA, "push must compute a version hash")
	assertSkillVersionHistory(t, controller, atA.Metadata.Slug, []skillVersionExpectation{
		{hash: hashA, tag: "stable", isCurrent: true},
	})

	atB := pushSkillArtifact(t, controller, "repoint-skill", "# Body B", "stable")
	hashB := atB.GetStatus().GetVersionHash()
	require.NotEqual(t, hashA, hashB, "changed content must change the version hash")
	// Single-holder: "stable" moved to B; A's row is now untagged.
	assertSkillVersionHistory(t, controller, atA.Metadata.Slug, []skillVersionExpectation{
		{hash: hashB, tag: "stable", isCurrent: true},
		{hash: hashA, tag: "", isCurrent: false},
	})

	rolledBack := pushSkillArtifact(t, controller, "repoint-skill", "# Body A", "stable")
	assert.Equal(t, hashA, rolledBack.GetStatus().GetVersionHash(),
		"re-pushing prior content must repoint the head to its hash")
	assert.Equal(t, hashB, rolledBack.GetMetadata().GetVersion().GetPreviousVersionId(),
		"the version chain must record the replaced head")
	// Still two rows — newest-archived first — with the tag AND currency on
	// the OLDER row: recency and currency legitimately diverge under repoint.
	assertSkillVersionHistory(t, controller, atA.Metadata.Slug, []skillVersionExpectation{
		{hash: hashB, tag: "", isCurrent: false},
		{hash: hashA, tag: "stable", isCurrent: true},
	})

	// Tag resolution follows the single holder: skill@stable is content A.
	resolved, err := controller.GetByReference(contextWithSkillKind(), &apiresourcepb.ApiResourceReference{
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Org:     "test-org",
		Slug:    atA.Metadata.Slug,
		Version: "stable",
	})
	require.NoError(t, err)
	assert.Equal(t, hashA, resolved.GetStatus().GetVersionHash(), "skill@stable must resolve to the tag's sole holder")
}

// TestSkillVersioning_SameContentRepushMovesTag pins the retag path: skills
// have no tagVersion RPC, so re-pushing existing content under a new tag is
// the only way to retag — it must move the audit column tag without adding a
// history row, and the old tag must stop resolving.
func TestSkillVersioning_SameContentRepushMovesTag(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	atV1 := pushSkillArtifact(t, controller, "retag-skill", "# Same body", "v1")
	hash := atV1.GetStatus().GetVersionHash()
	assertSkillVersionHistory(t, controller, atV1.Metadata.Slug, []skillVersionExpectation{
		{hash: hash, tag: "v1", isCurrent: true},
	})

	retagged := pushSkillArtifact(t, controller, "retag-skill", "# Same body", "v2")
	assert.Equal(t, hash, retagged.GetStatus().GetVersionHash(), "identical content must keep its hash")
	// One content, one row — the tag moved, no duplicate was inserted.
	assertSkillVersionHistory(t, controller, atV1.Metadata.Slug, []skillVersionExpectation{
		{hash: hash, tag: "v2", isCurrent: true},
	})

	// The old tag has no holder anymore.
	_, err := controller.GetByReference(contextWithSkillKind(), &apiresourcepb.ApiResourceReference{
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Org:     "test-org",
		Slug:    atV1.Metadata.Slug,
		Version: "v1",
	})
	require.Error(t, err, "a moved-away tag must stop resolving")
	assert.Equal(t, codes.NotFound, status.Code(err))
}

// TestSkillVersioning_LatestTagFollowsHead pins the dominant real-world path:
// the CLI defaults untagged pushes to the tag "latest", so under the
// single-holder model "latest" is a moving pointer to the newest push.
func TestSkillVersioning_LatestTagFollowsHead(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	atA := pushSkillArtifact(t, controller, "latest-skill", "# First", "latest")
	hashA := atA.GetStatus().GetVersionHash()

	atB := pushSkillArtifact(t, controller, "latest-skill", "# Second", "latest")
	hashB := atB.GetStatus().GetVersionHash()
	require.NotEqual(t, hashA, hashB)

	assertSkillVersionHistory(t, controller, atA.Metadata.Slug, []skillVersionExpectation{
		{hash: hashB, tag: "latest", isCurrent: true},
		{hash: hashA, tag: "", isCurrent: false},
	})
}
