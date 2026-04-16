package synthesis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
)

// =============================================================================
// GetResourceID Tests
// =============================================================================

func TestGetResourceID_SkillSynth(t *testing.T) {
	tests := []struct {
		name       string
		skillSynth *skillv1.SkillSynth
		expected   string
	}{
		{
			name: "skill synth with local path",
			skillSynth: &skillv1.SkillSynth{
				Source: &skillv1.SkillSynth_Local{
					Local: &skillv1.LocalDir{Path: "code-analysis"},
				},
			},
			expected: "skill_synth:code-analysis",
		},
		{
			name: "skill synth with git url",
			skillSynth: &skillv1.SkillSynth{
				Source: &skillv1.SkillSynth_Git{
					Git: &skillv1.Git{Url: "https://github.com/org/repo"},
				},
			},
			expected: "skill_synth:https://github.com/org/repo",
		},
		{
			name:       "skill synth with no source",
			skillSynth: &skillv1.SkillSynth{},
			expected:   "skill_synth:unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GetResourceID(tt.skillSynth)
			if result != tt.expected {
				t.Errorf("GetResourceID() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestGetResourceID_McpServer_Variations(t *testing.T) {
	tests := []struct {
		name      string
		mcpServer *mcpserverv1.McpServer
		expected  string
	}{
		{
			name: "mcp server with slug",
			mcpServer: &mcpserverv1.McpServer{
				Metadata: &apiresource.ApiResourceMetadata{Slug: "github-api"},
			},
			expected: "mcp_server:github-api",
		},
		{
			name: "mcp server with name fallback",
			mcpServer: &mcpserverv1.McpServer{
				Metadata: &apiresource.ApiResourceMetadata{Name: "GitHubAPI"},
			},
			expected: "mcp_server:githubapi",
		},
		{
			name: "mcp server uppercase converted to lowercase",
			mcpServer: &mcpserverv1.McpServer{
				Metadata: &apiresource.ApiResourceMetadata{Slug: "SLACK-API"},
			},
			expected: "mcp_server:slack-api",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GetResourceID(tt.mcpServer)
			if result != tt.expected {
				t.Errorf("GetResourceID() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestGetResourceID_Agent(t *testing.T) {
	tests := []struct {
		name     string
		agent    *agentv1.Agent
		expected string
	}{
		{
			name: "agent with slug",
			agent: &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{Slug: "code-reviewer"},
			},
			expected: "agent:code-reviewer",
		},
		{
			name: "agent with name fallback",
			agent: &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{Name: "CodeReviewer"},
			},
			expected: "agent:codereviewer",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GetResourceID(tt.agent)
			if result != tt.expected {
				t.Errorf("GetResourceID() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestGetResourceID_Workflow(t *testing.T) {
	tests := []struct {
		name     string
		workflow *workflowv1.Workflow
		expected string
	}{
		{
			name: "workflow with document name",
			workflow: &workflowv1.Workflow{
				Spec: &workflowv1.WorkflowSpec{
					Document: &workflowv1.WorkflowDocument{Name: "pr-review"},
				},
			},
			expected: "workflow:pr-review",
		},
		{
			name: "workflow without document returns unknown",
			workflow: &workflowv1.Workflow{
				Spec: &workflowv1.WorkflowSpec{},
			},
			expected: "workflow:unknown",
		},
		{
			name:     "workflow with nil spec returns unknown",
			workflow: &workflowv1.Workflow{},
			expected: "workflow:unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GetResourceID(tt.workflow)
			if result != tt.expected {
				t.Errorf("GetResourceID() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestGetResourceID_Unknown(t *testing.T) {
	// Test with nil message
	result := GetResourceID(nil)
	if result != "unknown" {
		t.Errorf("GetResourceID(nil) = %s, want unknown", result)
	}
}

// =============================================================================
// ReadFromDirectory Tests
// =============================================================================

func TestReadFromDirectory_EmptyDirectory(t *testing.T) {
	tempDir := t.TempDir()

	_, err := ReadFromDirectory(tempDir)
	if err == nil {
		t.Error("expected error for empty directory")
	}
	if err.Error() != "no resources found in synthesis output" {
		t.Errorf("unexpected error message: %s", err.Error())
	}
}

func TestReadFromDirectory_WithSkillSynth(t *testing.T) {
	tempDir := t.TempDir()

	skillSynth := &skillv1.SkillSynth{
		Source: &skillv1.SkillSynth_Local{
			Local: &skillv1.LocalDir{Path: "test-skill"},
		},
	}
	data, err := proto.Marshal(skillSynth)
	if err != nil {
		t.Fatalf("failed to marshal skill synth: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "skill-0.pb"), data, 0644); err != nil {
		t.Fatalf("failed to write skill file: %v", err)
	}

	result, err := ReadFromDirectory(tempDir)
	if err != nil {
		t.Fatalf("ReadFromDirectory failed: %v", err)
	}

	if len(result.SkillSynths) != 1 {
		t.Errorf("expected 1 skill synth, got %d", len(result.SkillSynths))
	}
	if result.SkillSynths[0].GetLocal().GetPath() != "test-skill" {
		t.Errorf("unexpected skill synth path: %s", result.SkillSynths[0].GetLocal().GetPath())
	}
}

func TestReadFromDirectory_WithMcpServer(t *testing.T) {
	tempDir := t.TempDir()

	// Create an MCP server proto file
	mcpServer := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Slug: "test-mcp"},
	}
	data, err := proto.Marshal(mcpServer)
	if err != nil {
		t.Fatalf("failed to marshal mcp server: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "mcpserver-0.pb"), data, 0644); err != nil {
		t.Fatalf("failed to write mcp server file: %v", err)
	}

	result, err := ReadFromDirectory(tempDir)
	if err != nil {
		t.Fatalf("ReadFromDirectory failed: %v", err)
	}

	if len(result.McpServers) != 1 {
		t.Errorf("expected 1 MCP server, got %d", len(result.McpServers))
	}
	if result.McpServers[0].GetMetadata().GetSlug() != "test-mcp" {
		t.Errorf("unexpected MCP server slug: %s", result.McpServers[0].GetMetadata().GetSlug())
	}
}

func TestReadFromDirectory_WithAgent(t *testing.T) {
	tempDir := t.TempDir()

	// Create an agent proto file
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Slug: "test-agent"},
	}
	data, err := proto.Marshal(agent)
	if err != nil {
		t.Fatalf("failed to marshal agent: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "agent-0.pb"), data, 0644); err != nil {
		t.Fatalf("failed to write agent file: %v", err)
	}

	result, err := ReadFromDirectory(tempDir)
	if err != nil {
		t.Fatalf("ReadFromDirectory failed: %v", err)
	}

	if len(result.Agents) != 1 {
		t.Errorf("expected 1 agent, got %d", len(result.Agents))
	}
	if result.Agents[0].GetMetadata().GetSlug() != "test-agent" {
		t.Errorf("unexpected agent slug: %s", result.Agents[0].GetMetadata().GetSlug())
	}
}

func TestReadFromDirectory_WithDependencies(t *testing.T) {
	tempDir := t.TempDir()

	skillSynth := &skillv1.SkillSynth{
		Source: &skillv1.SkillSynth_Local{
			Local: &skillv1.LocalDir{Path: "test-skill"},
		},
	}
	data, err := proto.Marshal(skillSynth)
	if err != nil {
		t.Fatalf("failed to marshal skill synth: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "skill-0.pb"), data, 0644); err != nil {
		t.Fatalf("failed to write skill file: %v", err)
	}

	// Create dependencies.json
	deps := map[string][]string{
		"agent:test-agent": {"skill_synth:test-skill"},
	}
	depsData, err := json.Marshal(deps)
	if err != nil {
		t.Fatalf("failed to marshal dependencies: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "dependencies.json"), depsData, 0644); err != nil {
		t.Fatalf("failed to write dependencies file: %v", err)
	}

	result, err := ReadFromDirectory(tempDir)
	if err != nil {
		t.Fatalf("ReadFromDirectory failed: %v", err)
	}

	if len(result.Dependencies) != 1 {
		t.Errorf("expected 1 dependency entry, got %d", len(result.Dependencies))
	}
	if len(result.Dependencies["agent:test-agent"]) != 1 {
		t.Errorf("expected 1 dependency for agent, got %d", len(result.Dependencies["agent:test-agent"]))
	}
}

func TestReadFromDirectory_WithAllResourceTypes(t *testing.T) {
	tempDir := t.TempDir()

	// Create skill synth
	skillSynth := &skillv1.SkillSynth{
		Source: &skillv1.SkillSynth_Local{Local: &skillv1.LocalDir{Path: "s1"}},
	}
	skillData, _ := proto.Marshal(skillSynth)
	os.WriteFile(filepath.Join(tempDir, "skill-0.pb"), skillData, 0644)

	// Create MCP server
	mcp := &mcpserverv1.McpServer{Metadata: &apiresource.ApiResourceMetadata{Slug: "m1"}}
	mcpData, _ := proto.Marshal(mcp)
	os.WriteFile(filepath.Join(tempDir, "mcpserver-0.pb"), mcpData, 0644)

	// Create agent
	agent := &agentv1.Agent{Metadata: &apiresource.ApiResourceMetadata{Slug: "a1"}}
	agentData, _ := proto.Marshal(agent)
	os.WriteFile(filepath.Join(tempDir, "agent-0.pb"), agentData, 0644)

	// Create workflow
	workflow := &workflowv1.Workflow{
		Spec: &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{Name: "w1"},
		},
	}
	workflowData, _ := proto.Marshal(workflow)
	os.WriteFile(filepath.Join(tempDir, "workflow-0.pb"), workflowData, 0644)

	result, err := ReadFromDirectory(tempDir)
	if err != nil {
		t.Fatalf("ReadFromDirectory failed: %v", err)
	}

	if result.SkillSynthCount() != 1 {
		t.Errorf("expected 1 skill synth, got %d", result.SkillSynthCount())
	}
	if result.McpServerCount() != 1 {
		t.Errorf("expected 1 MCP server, got %d", result.McpServerCount())
	}
	if result.AgentCount() != 1 {
		t.Errorf("expected 1 agent, got %d", result.AgentCount())
	}
	if result.WorkflowCount() != 1 {
		t.Errorf("expected 1 workflow, got %d", result.WorkflowCount())
	}
	if result.TotalResources() != 4 {
		t.Errorf("expected 4 total resources, got %d", result.TotalResources())
	}
}

func TestReadFromDirectory_MultipleOfSameType(t *testing.T) {
	tempDir := t.TempDir()

	// Create multiple MCP servers
	for i, slug := range []string{"github", "slack", "jira"} {
		mcp := &mcpserverv1.McpServer{Metadata: &apiresource.ApiResourceMetadata{Slug: slug}}
		data, _ := proto.Marshal(mcp)
		os.WriteFile(filepath.Join(tempDir, "mcpserver-"+string(rune('0'+i))+".pb"), data, 0644)
	}

	result, err := ReadFromDirectory(tempDir)
	if err != nil {
		t.Fatalf("ReadFromDirectory failed: %v", err)
	}

	if result.McpServerCount() != 3 {
		t.Errorf("expected 3 MCP servers, got %d", result.McpServerCount())
	}
}

func TestReadFromDirectory_MissingDependenciesFile(t *testing.T) {
	tempDir := t.TempDir()

	// Create only a skill synth (no dependencies.json)
	skillSynth := &skillv1.SkillSynth{
		Source: &skillv1.SkillSynth_Local{Local: &skillv1.LocalDir{Path: "test"}},
	}
	data, _ := proto.Marshal(skillSynth)
	os.WriteFile(filepath.Join(tempDir, "skill-0.pb"), data, 0644)

	result, err := ReadFromDirectory(tempDir)
	if err != nil {
		t.Fatalf("ReadFromDirectory failed: %v", err)
	}

	// Dependencies should be empty but not nil
	if result.Dependencies == nil {
		t.Error("expected non-nil Dependencies map")
	}
	if len(result.Dependencies) != 0 {
		t.Errorf("expected empty Dependencies, got %d entries", len(result.Dependencies))
	}
}

func TestReadFromDirectory_InvalidProtoFile(t *testing.T) {
	tempDir := t.TempDir()

	// Create an invalid proto file
	if err := os.WriteFile(filepath.Join(tempDir, "skill-0.pb"), []byte("invalid proto data"), 0644); err != nil {
		t.Fatalf("failed to write invalid file: %v", err)
	}

	_, err := ReadFromDirectory(tempDir)
	if err == nil {
		t.Error("expected error for invalid proto file")
	}
}

func TestReadFromDirectory_InvalidDependenciesJson(t *testing.T) {
	tempDir := t.TempDir()

	// Create a skill synth
	skillSynth := &skillv1.SkillSynth{
		Source: &skillv1.SkillSynth_Local{Local: &skillv1.LocalDir{Path: "test"}},
	}
	data, _ := proto.Marshal(skillSynth)
	os.WriteFile(filepath.Join(tempDir, "skill-0.pb"), data, 0644)

	// Create invalid dependencies.json
	os.WriteFile(filepath.Join(tempDir, "dependencies.json"), []byte("invalid json"), 0644)

	_, err := ReadFromDirectory(tempDir)
	if err == nil {
		t.Error("expected error for invalid dependencies.json")
	}
}
