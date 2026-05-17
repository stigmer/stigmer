//go:build integration

package integration

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"testing"
	"time"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// createTestSkill creates a minimal skill resource with the given SKILL.md content.
// The skill is auto-deleted on test cleanup.
func createTestSkill(t *testing.T, ctx context.Context, clients *harness.Clients, name, skillMDContent string) *skillv1.Skill {
	t.Helper()

	frontmatter := fmt.Sprintf("---\nname: %s\ndescription: Integration test skill\n---\n\n", name)
	fullContent := frontmatter + skillMDContent

	artifact, err := createSkillZip(fullContent)
	require.NoError(t, err, "create skill ZIP should succeed")

	skill, err := clients.SkillCommand.Push(ctx, &skillv1.PushSkillRequest{
		Org:      "test-org",
		Artifact: artifact,
		Tag:      "test",
	})
	require.NoError(t, err, "push skill should succeed")
	require.NotEmpty(t, skill.GetMetadata().GetId())

	t.Logf("created skill: name=%s, id=%s, slug=%s",
		skill.GetMetadata().GetName(),
		skill.GetMetadata().GetId(),
		skill.GetMetadata().GetSlug())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.SkillCommand.Delete(cleanCtx, &skillv1.SkillId{Value: skill.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up skill %s: %v", name, err)
		}
	})

	return skill
}

// createSkillZip creates a ZIP archive containing a single SKILL.md file.
func createSkillZip(content string) ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	f, err := w.Create("SKILL.md")
	if err != nil {
		return nil, fmt.Errorf("create SKILL.md in zip: %w", err)
	}
	if _, err := f.Write([]byte(content)); err != nil {
		return nil, fmt.Errorf("write SKILL.md content: %w", err)
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("close zip writer: %w", err)
	}

	return buf.Bytes(), nil
}
