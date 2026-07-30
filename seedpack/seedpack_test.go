package seedpack

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractToDir(t *testing.T) {
	destDir := t.TempDir()

	if err := ExtractToDir(destDir); err != nil {
		t.Fatalf("ExtractToDir() failed: %v", err)
	}

	expectedFiles := []string{
		"stigmer.yaml",
		"organizations/stigmer.yaml",
		"agents/skill-creator.yaml",
		"agents/agent-creator.yaml",
		"agents/mcp-server-creator.yaml",
		"mcp-servers/stigmer.yaml",
		"mcp-servers/github.yaml",
		"skills/skill-creator/SKILL.md",
		"skills/agent-creator/SKILL.md",
		"skills/mcp-server-creator/SKILL.md",
		"skills/workflow-creator/SKILL.md",
		"workflows/content-review-pipeline.yaml",
		"workflows/support-ticket-triage.yaml",
		"workflows/research-and-summarize.yaml",
	}

	for _, f := range expectedFiles {
		path := filepath.Join(destDir, f)
		info, err := os.Stat(path)
		if err != nil {
			t.Errorf("Expected file %s not found: %v", f, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("Expected file %s to have content, got empty", f)
		}
	}

	toolsDir := filepath.Join(destDir, "tools")
	if _, err := os.Stat(toolsDir); err == nil {
		t.Error("tools/ directory should NOT be embedded (build-time scripts only)")
	}
}

func TestExtractToDir_ProducesApplyableProject(t *testing.T) {
	destDir := t.TempDir()

	if err := ExtractToDir(destDir); err != nil {
		t.Fatalf("ExtractToDir() failed: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(destDir, "stigmer.yaml"))
	if err != nil {
		t.Fatalf("Failed to read stigmer.yaml: %v", err)
	}

	content := string(data)
	if !strings.Contains(content, "apiVersion: tenancy.stigmer.ai/v1") {
		t.Error("stigmer.yaml missing apiVersion")
	}
	if !strings.Contains(content, "kind: Project") {
		t.Error("stigmer.yaml missing kind: Project")
	}
	if !strings.Contains(content, "name: stigmer-seedpack") {
		t.Error("stigmer.yaml missing project name")
	}
}

func TestContentHash_Deterministic(t *testing.T) {
	h1, err := ContentHash()
	if err != nil {
		t.Fatalf("first ContentHash() failed: %v", err)
	}

	h2, err := ContentHash()
	if err != nil {
		t.Fatalf("second ContentHash() failed: %v", err)
	}

	if h1 != h2 {
		t.Errorf("ContentHash is not deterministic: %s != %s", h1, h2)
	}

	if !strings.HasPrefix(h1, "sha256:") {
		t.Errorf("Expected hash to start with 'sha256:', got '%s'", h1)
	}

	t.Logf("Content hash: %s", h1)
}

func TestContentHash_NonEmpty(t *testing.T) {
	hash, err := ContentHash()
	if err != nil {
		t.Fatalf("ContentHash() failed: %v", err)
	}

	if len(hash) < len("sha256:")+8 {
		t.Errorf("Hash too short: %s", hash)
	}
}
