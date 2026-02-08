package seedpack

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"testing"
)

func TestLoadManifest(t *testing.T) {
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest() failed: %v", err)
	}

	// Validate schema version
	if manifest.SchemaVersion != "1" {
		t.Errorf("Expected schema_version '1', got '%s'", manifest.SchemaVersion)
	}

	// Validate version
	if manifest.Version != "1.0.0" {
		t.Errorf("Expected version '1.0.0', got '%s'", manifest.Version)
	}

	// Validate skills
	if len(manifest.Skills) == 0 {
		t.Error("Expected at least one skill in manifest")
	}

	// Validate system agents
	if len(manifest.SystemAgents) == 0 {
		t.Error("Expected at least one system agent in manifest")
	}

	t.Logf("Manifest: version=%s, skills=%d, agents=%d",
		manifest.Version, len(manifest.Skills), len(manifest.SystemAgents))
}

func TestLoadManifest_SkillCreatorEntry(t *testing.T) {
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest() failed: %v", err)
	}

	// Find skill-creator entry
	var skillCreator *SkillEntry
	for i := range manifest.Skills {
		if manifest.Skills[i].Name == "skill-creator" {
			skillCreator = &manifest.Skills[i]
			break
		}
	}

	if skillCreator == nil {
		t.Fatal("skill-creator not found in manifest")
	}

	// Validate skill-creator entry
	if skillCreator.Path != "skills/skill-creator" {
		t.Errorf("Expected path 'skills/skill-creator', got '%s'", skillCreator.Path)
	}

	if !strings.HasPrefix(skillCreator.ContentDigest, "sha256:") {
		t.Errorf("Expected content_digest to start with 'sha256:', got '%s'", skillCreator.ContentDigest)
	}

	if skillCreator.Source.Type != "git" {
		t.Errorf("Expected source.type 'git', got '%s'", skillCreator.Source.Type)
	}

	if skillCreator.Source.URL != "https://github.com/anthropics/skills" {
		t.Errorf("Expected source.url 'https://github.com/anthropics/skills', got '%s'", skillCreator.Source.URL)
	}

	t.Logf("skill-creator: path=%s, digest=%s...",
		skillCreator.Path, skillCreator.ContentDigest[:30])
}

func TestLoadManifest_SkillCreatorAgentEntry(t *testing.T) {
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest() failed: %v", err)
	}

	// Find skill-creator-agent entry
	var agent *AgentEntry
	for i := range manifest.SystemAgents {
		if manifest.SystemAgents[i].Name == "skill-creator-agent" {
			agent = &manifest.SystemAgents[i]
			break
		}
	}

	if agent == nil {
		t.Fatal("skill-creator-agent not found in manifest")
	}

	// Validate agent entry
	if agent.Description == "" {
		t.Error("Expected non-empty description")
	}

	if agent.Instructions == "" {
		t.Error("Expected non-empty instructions")
	}

	if len(agent.SkillRefs) == 0 {
		t.Error("Expected at least one skill_ref")
	}

	// Verify skill-creator is referenced
	found := false
	for _, ref := range agent.SkillRefs {
		if ref == "skill-creator" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected skill-creator in skill_refs")
	}

	t.Logf("skill-creator-agent: skill_refs=%v", agent.SkillRefs)
}

func TestLoadSkillContent(t *testing.T) {
	content, err := LoadSkillContent("skills/skill-creator")
	if err != nil {
		t.Fatalf("LoadSkillContent() failed: %v", err)
	}

	if len(content) == 0 {
		t.Fatal("Expected non-empty SKILL.md content")
	}

	// Verify it starts with frontmatter
	if !strings.HasPrefix(content, "---\n") {
		t.Error("SKILL.md should start with frontmatter delimiter")
	}

	// Verify it contains expected sections
	if !strings.Contains(content, "name: skill-creator") {
		t.Error("SKILL.md should contain 'name: skill-creator'")
	}

	if !strings.Contains(content, "# Skill Creator") {
		t.Error("SKILL.md should contain '# Skill Creator' heading")
	}

	t.Logf("SKILL.md: %d bytes", len(content))
}

func TestLoadSkillMetadata(t *testing.T) {
	metadata, err := LoadSkillMetadata("skills/skill-creator")
	if err != nil {
		t.Fatalf("LoadSkillMetadata() failed: %v", err)
	}

	// Validate name
	if metadata.Name != "skill-creator" {
		t.Errorf("Expected name 'skill-creator', got '%s'", metadata.Name)
	}

	// Validate description is present
	if metadata.Description == "" {
		t.Error("Expected non-empty description")
	}

	t.Logf("Metadata: name=%s, description=%s...",
		metadata.Name, truncate(metadata.Description, 50))
}

func TestLoadSkillProvenance(t *testing.T) {
	prov, err := LoadSkillProvenance("skills/skill-creator")
	if err != nil {
		t.Fatalf("LoadSkillProvenance() failed: %v", err)
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
		t.Errorf("Expected source.url 'https://github.com/anthropics/skills', got '%s'", prov.Source.URL)
	}

	// Validate commit SHA length
	if len(prov.Source.CommitSHA) != 40 {
		t.Errorf("Expected 40-character commit SHA, got %d characters", len(prov.Source.CommitSHA))
	}

	// Validate content tracking
	if !strings.HasPrefix(prov.ContentDigest, "sha256:") {
		t.Errorf("Expected content_digest to start with 'sha256:', got '%s'", prov.ContentDigest)
	}

	if len(prov.Files) != 7 {
		t.Errorf("Expected 7 files tracked, got %d", len(prov.Files))
	}

	t.Logf("Provenance: commit=%s, files=%d",
		prov.Source.CommitSHA[:12], len(prov.Files))
}

func TestListSkillFiles(t *testing.T) {
	files, err := ListSkillFiles("skills/skill-creator")
	if err != nil {
		t.Fatalf("ListSkillFiles() failed: %v", err)
	}

	expectedFiles := []string{
		"LICENSE.txt",
		"SKILL.md",
		"provenance.json",
		"scripts/init_skill.py",
		"scripts/package_skill.py",
		"scripts/quick_validate.py",
		"references/output-patterns.md",
		"references/workflows.md",
	}

	// Sort both for comparison
	sort.Strings(files)
	sort.Strings(expectedFiles)

	if len(files) != len(expectedFiles) {
		t.Errorf("Expected %d files, got %d: %v", len(expectedFiles), len(files), files)
	}

	// Check each expected file exists
	for _, expected := range expectedFiles {
		found := false
		for _, f := range files {
			if f == expected {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Missing expected file: %s", expected)
		}
	}

	t.Logf("ListSkillFiles: %d files", len(files))
}

func TestLoadSkillFile(t *testing.T) {
	tests := []struct {
		name     string
		filePath string
		contains string
	}{
		{
			name:     "LICENSE.txt",
			filePath: "LICENSE.txt",
			contains: "Apache License",
		},
		{
			name:     "Python script",
			filePath: "scripts/init_skill.py",
			contains: "#!/usr/bin/env python3",
		},
		{
			name:     "Reference doc",
			filePath: "references/output-patterns.md",
			contains: "#",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := LoadSkillFile("skills/skill-creator", tt.filePath)
			if err != nil {
				t.Fatalf("LoadSkillFile(%s) failed: %v", tt.filePath, err)
			}

			if len(data) == 0 {
				t.Errorf("Expected non-empty content for %s", tt.filePath)
			}

			if !strings.Contains(string(data), tt.contains) {
				t.Errorf("Expected %s to contain '%s'", tt.filePath, tt.contains)
			}

			t.Logf("%s: %d bytes", tt.filePath, len(data))
		})
	}
}

func TestGetSkillByName(t *testing.T) {
	// Test existing skill
	skill, err := GetSkillByName("skill-creator")
	if err != nil {
		t.Fatalf("GetSkillByName('skill-creator') failed: %v", err)
	}

	if skill == nil {
		t.Fatal("Expected to find skill-creator")
	}

	if skill.Name != "skill-creator" {
		t.Errorf("Expected name 'skill-creator', got '%s'", skill.Name)
	}

	// Test non-existing skill
	missing, err := GetSkillByName("non-existent-skill")
	if err != nil {
		t.Fatalf("GetSkillByName('non-existent-skill') failed: %v", err)
	}

	if missing != nil {
		t.Error("Expected nil for non-existent skill")
	}
}

func TestGetAgentByName(t *testing.T) {
	// Test existing agent
	agent, err := GetAgentByName("skill-creator-agent")
	if err != nil {
		t.Fatalf("GetAgentByName('skill-creator-agent') failed: %v", err)
	}

	if agent == nil {
		t.Fatal("Expected to find skill-creator-agent")
	}

	if agent.Name != "skill-creator-agent" {
		t.Errorf("Expected name 'skill-creator-agent', got '%s'", agent.Name)
	}

	// Test non-existing agent
	missing, err := GetAgentByName("non-existent-agent")
	if err != nil {
		t.Fatalf("GetAgentByName('non-existent-agent') failed: %v", err)
	}

	if missing != nil {
		t.Error("Expected nil for non-existent agent")
	}
}

func TestParseSkillMdContent_ValidFrontmatter(t *testing.T) {
	validContent := `---
name: test-skill
description: A test skill
version: 1.0.0
---

# Test Skill

This is a test skill.
`

	metadata, err := parseSkillMdContent(validContent)
	if err != nil {
		t.Fatalf("parseSkillMdContent() failed: %v", err)
	}

	if metadata.Name != "test-skill" {
		t.Errorf("Expected name 'test-skill', got '%s'", metadata.Name)
	}

	if metadata.Description != "A test skill" {
		t.Errorf("Expected description 'A test skill', got '%s'", metadata.Description)
	}

	if metadata.Version != "1.0.0" {
		t.Errorf("Expected version '1.0.0', got '%s'", metadata.Version)
	}
}

func TestParseSkillMdContent_InvalidCases(t *testing.T) {
	tests := []struct {
		name    string
		content string
		wantErr string
	}{
		{
			name:    "empty content",
			content: "",
			wantErr: "empty",
		},
		{
			name:    "no frontmatter",
			content: "# Just a heading\n\nSome content.",
			wantErr: "must start with",
		},
		{
			name:    "unclosed frontmatter",
			content: "---\nname: test\n# Content without closing",
			wantErr: "not closed",
		},
		{
			name:    "missing name",
			content: "---\ndescription: A skill without name\n---\n# Content",
			wantErr: "missing required 'name'",
		},
		{
			name:    "invalid name format",
			content: "---\nname: Invalid Name With Spaces\n---\n# Content",
			wantErr: "must be kebab-case",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseSkillMdContent(tt.content)
			if err == nil {
				t.Error("Expected error, got nil")
				return
			}

			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Expected error containing '%s', got '%s'", tt.wantErr, err.Error())
			}
		})
	}
}

func TestVerifyContentDigest(t *testing.T) {
	// Load provenance to get expected digest
	prov, err := LoadSkillProvenance("skills/skill-creator")
	if err != nil {
		t.Fatalf("LoadSkillProvenance() failed: %v", err)
	}

	// Verify each file's digest
	for _, f := range prov.Files {
		data, err := LoadSkillFile("skills/skill-creator", f.Path)
		if err != nil {
			t.Errorf("Failed to load file %s: %v", f.Path, err)
			continue
		}

		// Calculate SHA256
		hash := sha256.Sum256(data)
		actualDigest := "sha256:" + hex.EncodeToString(hash[:])

		if actualDigest != f.Digest {
			t.Errorf("Digest mismatch for %s:\n  expected: %s\n  actual:   %s",
				f.Path, f.Digest, actualDigest)
		}
	}

	t.Logf("Verified %d file digests", len(prov.Files))
}

// truncate truncates a string to maxLen characters, adding "..." if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
