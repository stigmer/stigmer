package seedpack

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"testing"
)

func TestDiscoverManifest(t *testing.T) {
	manifest, err := DiscoverManifest()
	if err != nil {
		t.Fatalf("DiscoverManifest() failed: %v", err)
	}

	if manifest.ContentHash == "" {
		t.Error("Expected non-empty content hash")
	}

	if !strings.HasPrefix(manifest.ContentHash, "sha256:") {
		t.Errorf("Expected content hash to start with 'sha256:', got '%s'", manifest.ContentHash)
	}

	if len(manifest.Skills) < 2 {
		t.Errorf("Expected at least 2 skills (skill-creator, agent-creator), got %d", len(manifest.Skills))
	}

	if len(manifest.SystemAgents) == 0 {
		t.Error("Expected at least one system agent")
	}

	if len(manifest.McpServers) == 0 {
		t.Error("Expected at least one MCP server")
	}

	skillNames := make([]string, len(manifest.Skills))
	for i, s := range manifest.Skills {
		skillNames[i] = s.Name
	}
	t.Logf("Discovered: content_hash=%s, skills=%v, agents=%d, mcp_servers=%d",
		manifest.ContentHash, skillNames, len(manifest.SystemAgents), len(manifest.McpServers))
}

func TestDiscoverManifest_ContentHashDeterministic(t *testing.T) {
	m1, err := DiscoverManifest()
	if err != nil {
		t.Fatalf("first DiscoverManifest() failed: %v", err)
	}

	m2, err := DiscoverManifest()
	if err != nil {
		t.Fatalf("second DiscoverManifest() failed: %v", err)
	}

	if m1.ContentHash != m2.ContentHash {
		t.Errorf("Content hash is not deterministic: %s != %s", m1.ContentHash, m2.ContentHash)
	}
}

func TestDiscoverManifest_SkillsSorted(t *testing.T) {
	manifest, err := DiscoverManifest()
	if err != nil {
		t.Fatalf("DiscoverManifest() failed: %v", err)
	}

	for i := 1; i < len(manifest.Skills); i++ {
		if manifest.Skills[i].Name < manifest.Skills[i-1].Name {
			t.Errorf("Skills not sorted: %s comes after %s",
				manifest.Skills[i].Name, manifest.Skills[i-1].Name)
		}
	}
}

func TestDiscoverManifest_SkillCreatorEntry(t *testing.T) {
	skill, err := GetSkillByName("skill-creator")
	if err != nil {
		t.Fatalf("GetSkillByName('skill-creator') failed: %v", err)
	}

	if skill == nil {
		t.Fatal("skill-creator not discovered")
	}

	if skill.Path != "skills/skill-creator" {
		t.Errorf("Expected path 'skills/skill-creator', got '%s'", skill.Path)
	}

	if !strings.HasPrefix(skill.ContentDigest, "sha256:") {
		t.Errorf("Expected content_digest to start with 'sha256:', got '%s'", skill.ContentDigest)
	}

	t.Logf("skill-creator: path=%s, digest=%s...",
		skill.Path, skill.ContentDigest[:30])
}

func TestDiscoverManifest_AgentCreatorSkill(t *testing.T) {
	skill, err := GetSkillByName("agent-creator")
	if err != nil {
		t.Fatalf("GetSkillByName('agent-creator') failed: %v", err)
	}

	if skill == nil {
		t.Fatal("agent-creator not discovered (this was the bug that motivated auto-discovery)")
	}

	if skill.Path != "skills/agent-creator" {
		t.Errorf("Expected path 'skills/agent-creator', got '%s'", skill.Path)
	}

	if !strings.HasPrefix(skill.ContentDigest, "sha256:") {
		t.Errorf("Expected content_digest to start with 'sha256:', got '%s'", skill.ContentDigest)
	}

	t.Logf("agent-creator: path=%s, digest=%s...",
		skill.Path, skill.ContentDigest[:30])
}

func TestDiscoverManifest_AgentEntry(t *testing.T) {
	agent, err := GetAgentByName("skill-creator-agent")
	if err != nil {
		t.Fatalf("GetAgentByName('skill-creator-agent') failed: %v", err)
	}

	if agent == nil {
		t.Fatal("skill-creator-agent not discovered")
	}

	if agent.Path != "agents/skill-creator-agent.yaml" {
		t.Errorf("Expected path 'agents/skill-creator-agent.yaml', got '%s'", agent.Path)
	}

	t.Logf("skill-creator-agent: name=%s, path=%s", agent.Name, agent.Path)
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

func TestCreateSkillZIP(t *testing.T) {
	zipData, err := CreateSkillZIP("skills/skill-creator")
	if err != nil {
		t.Fatalf("CreateSkillZIP() failed: %v", err)
	}

	if len(zipData) == 0 {
		t.Fatal("Expected non-empty ZIP data")
	}

	if len(zipData) < 4 || string(zipData[:2]) != "PK" {
		t.Error("Expected valid ZIP file (PK magic bytes)")
	}

	expectedFiles, err := ListSkillFiles("skills/skill-creator")
	if err != nil {
		t.Fatalf("ListSkillFiles() failed: %v", err)
	}

	zipReader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("Failed to open generated ZIP: %v", err)
	}

	zipFileNames := make(map[string]bool)
	for _, f := range zipReader.File {
		zipFileNames[f.Name] = true
	}

	for _, expected := range expectedFiles {
		if !zipFileNames[expected] {
			t.Errorf("Missing file in ZIP: %s", expected)
		}
	}

	if len(zipReader.File) != len(expectedFiles) {
		t.Errorf("ZIP has %d files, expected %d", len(zipReader.File), len(expectedFiles))
	}

	t.Logf("CreateSkillZIP: %d bytes, %d files", len(zipData), len(zipReader.File))
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

func TestDiscoverManifest_McpServerEntry(t *testing.T) {
	mcpServer, err := GetMcpServerByName("stigmer-mcp-server")
	if err != nil {
		t.Fatalf("GetMcpServerByName('stigmer-mcp-server') failed: %v", err)
	}

	if mcpServer == nil {
		t.Fatal("stigmer-mcp-server not discovered")
	}

	if mcpServer.Path != "mcp-servers/stigmer-mcp-server.yaml" {
		t.Errorf("Expected path 'mcp-servers/stigmer-mcp-server.yaml', got '%s'", mcpServer.Path)
	}

	t.Logf("stigmer-mcp-server: name=%s, path=%s", mcpServer.Name, mcpServer.Path)
}

func TestComputeSkillDigest(t *testing.T) {
	digest, err := computeSkillDigest("skills/skill-creator")
	if err != nil {
		t.Fatalf("computeSkillDigest() failed: %v", err)
	}

	if !strings.HasPrefix(digest, "sha256:") {
		t.Errorf("Expected digest to start with 'sha256:', got '%s'", digest)
	}

	digest2, err := computeSkillDigest("skills/skill-creator")
	if err != nil {
		t.Fatalf("second computeSkillDigest() failed: %v", err)
	}

	if digest != digest2 {
		t.Errorf("Digest is not deterministic: %s != %s", digest, digest2)
	}

	t.Logf("skill-creator digest: %s", digest)
}

func TestExtractYAMLMetadataName(t *testing.T) {
	tests := []struct {
		name     string
		yaml     string
		wantName string
		wantErr  bool
	}{
		{
			name:     "valid agent YAML",
			yaml:     "apiVersion: v1\nkind: Agent\nmetadata:\n  name: test-agent\nspec:\n  description: test\n",
			wantName: "test-agent",
		},
		{
			name:    "missing metadata",
			yaml:    "apiVersion: v1\nkind: Agent\nspec:\n  description: test\n",
			wantErr: true,
		},
		{
			name:    "empty name",
			yaml:    "metadata:\n  name: \"\"\n",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			name, err := extractYAMLMetadataName([]byte(tt.yaml))
			if tt.wantErr {
				if err == nil {
					t.Error("Expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("extractYAMLMetadataName() failed: %v", err)
			}
			if name != tt.wantName {
				t.Errorf("Expected name '%s', got '%s'", tt.wantName, name)
			}
		})
	}
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

	expectedArgs := []string{"run", "github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@v0.0.17"}
	if len(stdio.Args) != len(expectedArgs) {
		t.Errorf("Expected %d args, got %d: %v", len(expectedArgs), len(stdio.Args), stdio.Args)
	} else {
		for i, arg := range expectedArgs {
			if stdio.Args[i] != arg {
				t.Errorf("Expected args[%d]=%q, got %q", i, arg, stdio.Args[i])
			}
		}
	}

	envSpec := mcpServer.Spec.GetEnvSpec()
	if envSpec == nil {
		t.Fatal("Expected non-nil env_spec")
	}
	if _, ok := envSpec.Data["STIGMER_SERVER_ADDRESS"]; !ok {
		t.Error("Expected STIGMER_SERVER_ADDRESS in env_spec")
	}
	if _, ok := envSpec.Data["STIGMER_API_KEY"]; !ok {
		t.Error("Expected STIGMER_API_KEY in env_spec")
	}
	if apiKey, ok := envSpec.Data["STIGMER_API_KEY"]; ok && !apiKey.IsSecret {
		t.Error("Expected STIGMER_API_KEY to be marked as secret")
	}

	t.Logf("stigmer-mcp-server: description=%s..., command=%s %v, env_spec_keys=%d",
		truncate(mcpServer.Spec.Description, 50), stdio.Command, stdio.Args, len(envSpec.Data))
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
