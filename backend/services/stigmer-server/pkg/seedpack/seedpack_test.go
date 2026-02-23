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
	if manifest.SchemaVersion != "3" {
		t.Errorf("Expected schema_version '3', got '%s'", manifest.SchemaVersion)
	}

	// Validate version
	if manifest.Version != "1.3.0" {
		t.Errorf("Expected version '1.3.0', got '%s'", manifest.Version)
	}

	// Validate skills
	if len(manifest.Skills) == 0 {
		t.Error("Expected at least one skill in manifest")
	}

	// Validate system agents
	if len(manifest.SystemAgents) == 0 {
		t.Error("Expected at least one system agent in manifest")
	}

	// Validate MCP servers
	if len(manifest.McpServers) == 0 {
		t.Error("Expected at least one MCP server in manifest")
	}

	t.Logf("Manifest: version=%s, skills=%d, agents=%d, mcp_servers=%d",
		manifest.Version, len(manifest.Skills), len(manifest.SystemAgents), len(manifest.McpServers))
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

	// Validate artifact path (schema v2)
	if skillCreator.ArtifactPath != "artifacts/skill-creator.zip" {
		t.Errorf("Expected artifact_path 'artifacts/skill-creator.zip', got '%s'", skillCreator.ArtifactPath)
	}

	// Validate artifact digest
	if !strings.HasPrefix(skillCreator.ArtifactDigest, "sha256:") {
		t.Errorf("Expected artifact_digest to start with 'sha256:', got '%s'", skillCreator.ArtifactDigest)
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

	t.Logf("skill-creator: path=%s, artifact=%s, digest=%s...",
		skillCreator.Path, skillCreator.ArtifactPath, skillCreator.ContentDigest[:30])
}

func TestLoadManifest_SkillCreatorAgentEntry(t *testing.T) {
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest() failed: %v", err)
	}

	// Find skill-creator-agent entry
	var agentEntry *AgentEntry
	for i := range manifest.SystemAgents {
		if manifest.SystemAgents[i].Name == "skill-creator-agent" {
			agentEntry = &manifest.SystemAgents[i]
			break
		}
	}

	if agentEntry == nil {
		t.Fatal("skill-creator-agent not found in manifest")
	}

	// Validate agent entry has correct path (schema v2)
	if agentEntry.Path != "agents/skill-creator-agent.yaml" {
		t.Errorf("Expected path 'agents/skill-creator-agent.yaml', got '%s'", agentEntry.Path)
	}

	t.Logf("skill-creator-agent: name=%s, path=%s", agentEntry.Name, agentEntry.Path)
}

func TestLoadAgentYAML(t *testing.T) {
	// Load agent from YAML file
	agent, err := LoadAgentYAML("agents/skill-creator-agent.yaml")
	if err != nil {
		t.Fatalf("LoadAgentYAML() failed: %v", err)
	}

	if agent == nil {
		t.Fatal("Expected non-nil agent")
	}

	// Validate metadata
	if agent.Metadata == nil {
		t.Fatal("Expected non-nil metadata")
	}

	if agent.Metadata.Name != "skill-creator-agent" {
		t.Errorf("Expected name 'skill-creator-agent', got '%s'", agent.Metadata.Name)
	}

	// Validate spec
	if agent.Spec == nil {
		t.Fatal("Expected non-nil spec")
	}

	if agent.Spec.Description == "" {
		t.Error("Expected non-empty description")
	}

	if agent.Spec.Instructions == "" {
		t.Error("Expected non-empty instructions")
	}

	if len(agent.Spec.SkillRefs) == 0 {
		t.Error("Expected at least one skill_ref")
	}

	// Verify skill-creator is referenced
	found := false
	for _, ref := range agent.Spec.SkillRefs {
		if ref.Slug == "skill-creator" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected skill-creator in skill_refs")
	}

	t.Logf("skill-creator-agent: description=%s..., skill_refs=%d",
		truncate(agent.Spec.Description, 50), len(agent.Spec.SkillRefs))
}

func TestLoadSkillArtifact(t *testing.T) {
	// Load the pre-built ZIP artifact
	zipData, err := LoadSkillArtifact("artifacts/skill-creator.zip")
	if err != nil {
		t.Fatalf("LoadSkillArtifact() failed: %v", err)
	}

	if len(zipData) == 0 {
		t.Fatal("Expected non-empty ZIP data")
	}

	// Verify it's a valid ZIP (check magic bytes)
	// ZIP files start with PK\x03\x04
	if len(zipData) < 4 || string(zipData[:2]) != "PK" {
		t.Error("Expected valid ZIP file (PK magic bytes)")
	}

	// Verify artifact digest matches manifest
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest() failed: %v", err)
	}

	skill, err := GetSkillByName("skill-creator")
	if err != nil {
		t.Fatalf("GetSkillByName() failed: %v", err)
	}

	if skill.ArtifactDigest == "" {
		t.Error("Expected non-empty artifact_digest in manifest")
	}

	// Calculate actual digest
	hash := sha256.Sum256(zipData)
	actualDigest := "sha256:" + hex.EncodeToString(hash[:])

	if actualDigest != skill.ArtifactDigest {
		t.Errorf("Artifact digest mismatch:\n  expected: %s\n  actual:   %s",
			skill.ArtifactDigest, actualDigest)
	}

	t.Logf("Artifact: %d bytes, digest=%s", len(zipData), actualDigest[:40]+"...")

	// Suppress unused variable warning
	_ = manifest
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

func TestLoadManifest_McpServerEntry(t *testing.T) {
	manifest, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest() failed: %v", err)
	}

	var mcpEntry *McpServerEntry
	for i := range manifest.McpServers {
		if manifest.McpServers[i].Name == "stigmer-mcp-server" {
			mcpEntry = &manifest.McpServers[i]
			break
		}
	}

	if mcpEntry == nil {
		t.Fatal("stigmer-mcp-server not found in manifest")
	}

	if mcpEntry.Path != "mcp-servers/stigmer-mcp-server.yaml" {
		t.Errorf("Expected path 'mcp-servers/stigmer-mcp-server.yaml', got '%s'", mcpEntry.Path)
	}

	t.Logf("stigmer-mcp-server: name=%s, path=%s", mcpEntry.Name, mcpEntry.Path)
}

func TestLoadMcpServerYAML(t *testing.T) {
	mcpServer, err := LoadMcpServerYAML("mcp-servers/stigmer-mcp-server.yaml")
	if err != nil {
		t.Fatalf("LoadMcpServerYAML() failed: %v", err)
	}

	if mcpServer == nil {
		t.Fatal("Expected non-nil MCP server")
	}

	if mcpServer.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("Expected apiVersion 'agentic.stigmer.ai/v1', got '%s'", mcpServer.ApiVersion)
	}

	if mcpServer.Kind != "McpServer" {
		t.Errorf("Expected kind 'McpServer', got '%s'", mcpServer.Kind)
	}

	if mcpServer.Metadata == nil {
		t.Fatal("Expected non-nil metadata")
	}

	if mcpServer.Metadata.Name != "stigmer-mcp-server" {
		t.Errorf("Expected name 'stigmer-mcp-server', got '%s'", mcpServer.Metadata.Name)
	}

	if mcpServer.Spec == nil {
		t.Fatal("Expected non-nil spec")
	}

	if mcpServer.Spec.Description == "" {
		t.Error("Expected non-empty description")
	}

	stdio := mcpServer.Spec.GetStdio()
	if stdio == nil {
		t.Fatal("Expected stdio server config")
	}

	if stdio.Command != "go" {
		t.Errorf("Expected command 'go', got '%s'", stdio.Command)
	}

	expectedArgs := []string{"run", "github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest"}
	if len(stdio.Args) != len(expectedArgs) || stdio.Args[0] != expectedArgs[0] || stdio.Args[1] != expectedArgs[1] {
		t.Errorf("Expected args %v, got %v", expectedArgs, stdio.Args)
	}

	t.Logf("stigmer-mcp-server: description=%s..., command=%s %v",
		truncate(mcpServer.Spec.Description, 50), stdio.Command, stdio.Args)
}

func TestGetMcpServerByName(t *testing.T) {
	mcpServer, err := GetMcpServerByName("stigmer-mcp-server")
	if err != nil {
		t.Fatalf("GetMcpServerByName('stigmer-mcp-server') failed: %v", err)
	}

	if mcpServer == nil {
		t.Fatal("Expected to find stigmer-mcp-server")
	}

	if mcpServer.Name != "stigmer-mcp-server" {
		t.Errorf("Expected name 'stigmer-mcp-server', got '%s'", mcpServer.Name)
	}

	missing, err := GetMcpServerByName("non-existent-mcp-server")
	if err != nil {
		t.Fatalf("GetMcpServerByName('non-existent-mcp-server') failed: %v", err)
	}

	if missing != nil {
		t.Error("Expected nil for non-existent MCP server")
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
