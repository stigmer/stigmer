package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Test Helpers
// =============================================================================

func createTestFile(t *testing.T, dir, filename, content string) string {
	t.Helper()
	path := filepath.Join(dir, filename)
	err := os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
	return path
}

func minimalValidAgentYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
spec:
  instructions: "You are a helpful assistant that answers questions."
`
}

func fullAgentYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  slug: code-reviewer
spec:
  description: An AI agent that reviews code changes
  instructions: |
    You are a senior code reviewer. Focus on:
    - Code quality and maintainability
    - Security vulnerabilities
    - Performance implications
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        org: stigmer
        slug: github
      enabled_tools:
        - search_code
        - get_file
  skill_refs:
    - kind: skill
      org: stigmer
      slug: code-review-best-practices
`
}

func minimalValidAgentJSON() string {
	return `{
  "apiVersion": "agentic.stigmer.ai/v1",
  "kind": "Agent",
  "metadata": {
    "name": "test-agent"
  },
  "spec": {
    "instructions": "You are a helpful assistant that answers questions."
  }
}`
}

// =============================================================================
// File Resolution Tests
// =============================================================================

func TestLoad_ExplicitPath(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "custom-agent.yaml", minimalValidAgentYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, path, result.SourcePath)
	assert.Equal(t, "test-agent", result.Agent.Metadata.Name)
}

func TestLoad_AutoDetect(t *testing.T) {
	dir := t.TempDir()
	createTestFile(t, dir, "agent.yaml", minimalValidAgentYAML())

	// Change to the test directory
	originalWd, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalWd) }()

	err = os.Chdir(dir)
	require.NoError(t, err)

	result, err := Load(&LoadOptions{})
	require.NoError(t, err)
	// Use filepath.Base to avoid /var vs /private/var symlink issues on macOS
	assert.Equal(t, "agent.yaml", filepath.Base(result.SourcePath))
	assert.Equal(t, "test-agent", result.Agent.Metadata.Name)
}

func TestLoad_AutoDetectAlternate(t *testing.T) {
	dir := t.TempDir()
	// Only create AGENT.yaml (not agent.yaml) to test alternate detection
	// Note: On case-insensitive filesystems (macOS default), agent.yaml search
	// may match AGENT.yaml, which is acceptable behavior.
	createTestFile(t, dir, "AGENT.yaml", minimalValidAgentYAML())

	originalWd, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalWd) }()

	err = os.Chdir(dir)
	require.NoError(t, err)

	result, err := Load(&LoadOptions{})
	require.NoError(t, err)
	// Verify the agent was loaded correctly (filename may vary by filesystem case sensitivity)
	assert.NotEmpty(t, result.SourcePath)
	assert.Equal(t, "test-agent", result.Agent.Metadata.Name)
}

func TestLoad_FileNotFound(t *testing.T) {
	_, err := Load(&LoadOptions{FilePath: "/nonexistent/path/agent.yaml"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "file not found")
}

func TestLoad_NoConfigFound(t *testing.T) {
	dir := t.TempDir()

	originalWd, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalWd) }()

	err = os.Chdir(dir)
	require.NoError(t, err)

	_, err = Load(&LoadOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no Agent configuration found")
	assert.Contains(t, err.Error(), "agent.yaml")
	assert.Contains(t, err.Error(), "AGENT.yaml")
}

// =============================================================================
// Parsing Tests
// =============================================================================

func TestLoad_ValidYAML(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "agent.yaml", minimalValidAgentYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Agent.ApiVersion)
	assert.Equal(t, "Agent", result.Agent.Kind)
	assert.Equal(t, "test-agent", result.Agent.Metadata.Name)
	assert.NotEmpty(t, result.Agent.Spec.Instructions)
}

func TestLoad_ValidJSON(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "agent.json", minimalValidAgentJSON())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Agent.ApiVersion)
	assert.Equal(t, "Agent", result.Agent.Kind)
	assert.Equal(t, "test-agent", result.Agent.Metadata.Name)
}

func TestLoad_InvalidYAMLSyntax(t *testing.T) {
	dir := t.TempDir()
	invalidYAML := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test
  invalid yaml here: [unclosed bracket
`
	path := createTestFile(t, dir, "agent.yaml", invalidYAML)

	_, err := Load(&LoadOptions{FilePath: path})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse YAML")
}

func TestLoad_UnknownFieldsRejected(t *testing.T) {
	dir := t.TempDir()
	yamlWithUnknownField := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
spec:
  instructions: "You are a helpful assistant that answers questions."
  unknownField: "this should be rejected"
`
	path := createTestFile(t, dir, "agent.yaml", yamlWithUnknownField)

	_, err := Load(&LoadOptions{FilePath: path})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse Agent configuration")
}

// =============================================================================
// Protovalidate Tests (proto rules are source of truth)
// =============================================================================

func TestLoad_ProtovalidateErrors(t *testing.T) {
	tests := []struct {
		name          string
		yaml          string
		errorContains string
	}{
		{
			name: "wrong apiVersion",
			yaml: `apiVersion: wrong/v1
kind: Agent
metadata:
  name: test-agent
spec:
  instructions: "You are a helpful assistant that answers questions."
`,
			errorContains: "agent validation failed",
		},
		{
			name: "wrong kind",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: WrongKind
metadata:
  name: test-agent
spec:
  instructions: "You are a helpful assistant that answers questions."
`,
			errorContains: "agent validation failed",
		},
		{
			name: "missing metadata",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Agent
spec:
  instructions: "You are a helpful assistant that answers questions."
`,
			errorContains: "agent validation failed",
		},
		{
			name: "instructions too short",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
spec:
  instructions: "short"
`,
			errorContains: "agent validation failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := createTestFile(t, dir, "agent.yaml", tt.yaml)

			_, err := Load(&LoadOptions{FilePath: path})
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.errorContains)
		})
	}
}

// =============================================================================
// Success Cases
// =============================================================================

func TestLoad_MinimalValidAgent(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "agent.yaml", minimalValidAgentYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Equal(t, "agentic.stigmer.ai/v1", result.Agent.ApiVersion)
	assert.Equal(t, "Agent", result.Agent.Kind)
	assert.NotNil(t, result.Agent.Metadata)
	assert.Equal(t, "test-agent", result.Agent.Metadata.Name)
	assert.NotNil(t, result.Agent.Spec)
	assert.NotEmpty(t, result.Agent.Spec.Instructions)
}

func TestLoad_FullAgent(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "agent.yaml", fullAgentYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Equal(t, "agentic.stigmer.ai/v1", result.Agent.ApiVersion)
	assert.Equal(t, "Agent", result.Agent.Kind)
	assert.Equal(t, "code-reviewer", result.Agent.Metadata.Name)
	assert.Equal(t, "code-reviewer", result.Agent.Metadata.Slug)
	assert.Equal(t, "An AI agent that reviews code changes", result.Agent.Spec.Description)
	assert.NotEmpty(t, result.Agent.Spec.Instructions)
	assert.Len(t, result.Agent.Spec.McpServerUsages, 1)
	assert.Len(t, result.Agent.Spec.SkillRefs, 1)

	// Verify MCP server usage
	mcpUsage := result.Agent.Spec.McpServerUsages[0]
	assert.NotNil(t, mcpUsage.McpServerRef)
	assert.Equal(t, "github", mcpUsage.McpServerRef.Slug)
	assert.Contains(t, mcpUsage.EnabledTools, "search_code")
	assert.Contains(t, mcpUsage.EnabledTools, "get_file")

	// Verify skill ref
	skillRef := result.Agent.Spec.SkillRefs[0]
	assert.Equal(t, "code-review-best-practices", skillRef.Slug)
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestLoad_EmptySpec(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
spec:
  instructions: "You are a helpful assistant that answers questions."
`
	path := createTestFile(t, dir, "agent.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.NotNil(t, result.Agent.Spec)
	assert.Empty(t, result.Agent.Spec.McpServerUsages)
	assert.Empty(t, result.Agent.Spec.SkillRefs)
}

func TestLoad_YAMLSpecialCharacters(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
spec:
  description: "Description with special chars: <>&\"'"
  instructions: |
    Multi-line instructions with special chars:
    - Bullet point 1
    - Bullet point 2
    Code block: ` + "`" + `echo "hello"` + "`" + `
`
	path := createTestFile(t, dir, "agent.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Contains(t, result.Agent.Spec.Description, "<>&")
	assert.Contains(t, result.Agent.Spec.Instructions, "Bullet point")
}
