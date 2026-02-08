package seedpack_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
)

// getTestDir returns the directory containing the seedpack test data.
// It tries multiple strategies to work in both `go test` and `bazel test`.
func getTestDir() string {
	// Strategy 1: Try Bazel runfiles path (when running under bazel test)
	// Bazel sets TEST_SRCDIR and TEST_WORKSPACE environment variables
	if srcdir := os.Getenv("TEST_SRCDIR"); srcdir != "" {
		workspace := os.Getenv("TEST_WORKSPACE")
		if workspace == "" {
			workspace = "_main"
		}
		bazelPath := filepath.Join(srcdir, workspace, "client-apps/cli/internal/seedpack")
		if _, err := os.Stat(bazelPath); err == nil {
			return bazelPath
		}
	}

	// Strategy 2: Try relative to current working directory (Bazel runfiles root)
	if cwd, err := os.Getwd(); err == nil {
		// Check if we're in Bazel's runfiles directory
		bazelPath := filepath.Join(cwd, "client-apps/cli/internal/seedpack")
		if _, err := os.Stat(bazelPath); err == nil {
			return bazelPath
		}
	}

	// Strategy 3: Use runtime.Caller to get source file location (for go test)
	_, filename, _, ok := runtime.Caller(0)
	if ok {
		return filepath.Dir(filename)
	}

	// Fallback: return current directory
	return "."
}

// Provenance represents the provenance.json schema
type Provenance struct {
	SchemaVersion string `json:"schema_version"`
	Source        struct {
		Type      string `json:"type"`
		URL       string `json:"url"`
		Ref       string `json:"ref"`
		CommitSHA string `json:"commit_sha"`
		Subdir    string `json:"subdir"`
	} `json:"source"`
	VendoredAt    string `json:"vendored_at"`
	VendoredBy    string `json:"vendored_by"`
	ContentDigest string `json:"content_digest"`
	Files         []struct {
		Path   string `json:"path"`
		Digest string `json:"digest"`
	} `json:"files"`
}

func TestSkillCreatorVendored(t *testing.T) {
	testDir := getTestDir()
	skillDir := filepath.Join(testDir, "skills", "skill-creator")

	// Test 1: SKILL.md parses with existing Stigmer parser
	t.Run("SKILL.md parses correctly", func(t *testing.T) {
		metadata, err := artifact.ParseSkillMetadata(skillDir)
		if err != nil {
			t.Fatalf("Failed to parse SKILL.md with Stigmer parser: %v", err)
		}

		if metadata.Name != "skill-creator" {
			t.Errorf("Expected name 'skill-creator', got '%s'", metadata.Name)
		}

		if metadata.Description == "" {
			t.Error("Expected non-empty description")
		}

		t.Logf("Parsed skill: name=%s, description=%s...", metadata.Name, metadata.Description[:50])
	})

	// Test 2: LICENSE.txt exists and is Apache 2.0
	t.Run("LICENSE.txt is Apache 2.0", func(t *testing.T) {
		licensePath := filepath.Join(skillDir, "LICENSE.txt")
		content, err := os.ReadFile(licensePath)
		if err != nil {
			t.Fatalf("Failed to read LICENSE.txt: %v", err)
		}

		if len(content) == 0 {
			t.Fatal("LICENSE.txt is empty")
		}

		// Check it's Apache License
		contentStr := string(content)
		if !containsString(contentStr, "Apache License") {
			t.Fatal("LICENSE.txt does not contain 'Apache License'")
		}
		if !containsString(contentStr, "Version 2.0") {
			t.Fatal("LICENSE.txt does not contain 'Version 2.0'")
		}

		t.Logf("LICENSE.txt: %d bytes, Apache 2.0 verified", len(content))
	})

	// Test 3: provenance.json is valid and complete
	t.Run("provenance.json is valid", func(t *testing.T) {
		provPath := filepath.Join(skillDir, "provenance.json")
		content, err := os.ReadFile(provPath)
		if err != nil {
			t.Fatalf("Failed to read provenance.json: %v", err)
		}

		var prov Provenance
		if err := json.Unmarshal(content, &prov); err != nil {
			t.Fatalf("Failed to parse provenance.json: %v", err)
		}

		// Validate schema version
		if prov.SchemaVersion != "1" {
			t.Errorf("Expected schema_version '1', got '%s'", prov.SchemaVersion)
		}

		// Validate source
		if prov.Source.Type != "git" {
			t.Errorf("Expected source.type 'git', got '%s'", prov.Source.Type)
		}
		if prov.Source.URL != "https://github.com/anthropics/skills" {
			t.Errorf("Unexpected source.url: %s", prov.Source.URL)
		}
		if len(prov.Source.CommitSHA) != 40 {
			t.Errorf("Invalid commit SHA length: %d (expected 40)", len(prov.Source.CommitSHA))
		}

		// Validate content tracking
		if prov.ContentDigest == "" {
			t.Error("Missing content_digest")
		}
		if len(prov.Files) != 7 {
			t.Errorf("Expected 7 files tracked, got %d", len(prov.Files))
		}

		t.Logf("Provenance: commit=%s, digest=%s..., files=%d",
			prov.Source.CommitSHA[:12],
			prov.ContentDigest[:20],
			len(prov.Files))
	})

	// Test 4: All expected files exist
	t.Run("all expected files exist", func(t *testing.T) {
		expectedFiles := []string{
			"SKILL.md",
			"LICENSE.txt",
			"provenance.json",
			"scripts/init_skill.py",
			"scripts/package_skill.py",
			"scripts/quick_validate.py",
			"references/output-patterns.md",
			"references/workflows.md",
		}

		for _, f := range expectedFiles {
			path := filepath.Join(skillDir, f)
			info, err := os.Stat(path)
			if os.IsNotExist(err) {
				t.Errorf("Missing expected file: %s", f)
				continue
			}
			if err != nil {
				t.Errorf("Error checking file %s: %v", f, err)
				continue
			}
			if info.Size() == 0 {
				t.Errorf("File %s is empty", f)
			}
		}
	})
}

func containsString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
