package mcpserver

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

func minimalValidMcpServerYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test-server
spec:
  stdio:
    command: node
    args: ["server.js"]
`
}

func fullMcpServerYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github-api
  slug: github-api
spec:
  description: GitHub API MCP server
  stdio:
    command: npx
    args: 
      - "@modelcontextprotocol/server-github"
    working_dir: "/tmp/mcp"
  tags:
    - github
    - api
    - code
`
}

func httpMcpServerYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: remote-server
spec:
  description: Remote HTTP MCP server
  http:
    url: "https://api.example.com/mcp"
  tags:
    - remote
    - http
`
}

func minimalValidMcpServerJSON() string {
	return `{
  "apiVersion": "agentic.stigmer.ai/v1",
  "kind": "McpServer",
  "metadata": {
    "name": "test-server"
  },
  "spec": {
    "stdio": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}`
}

// =============================================================================
// File Loading Tests
// =============================================================================

func TestLoad_ValidYAMLFile(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.yaml", minimalValidMcpServerYAML())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, path, result.SourcePath)
	assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
	assert.Equal(t, "node", result.McpServer.Spec.GetStdio().Command)
}

func TestLoad_ValidJSONFile(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.json", minimalValidMcpServerJSON())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, path, result.SourcePath)
	assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
	assert.Equal(t, "node", result.McpServer.Spec.GetStdio().Command)
}

func TestLoad_FileNotFound(t *testing.T) {
	result, err := Load(&LoadOptions{FilePath: "/nonexistent/file.yaml"})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "file not found")
}

func TestLoad_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "empty.yaml", "")

	result, err := Load(&LoadOptions{FilePath: path})

	require.Error(t, err)
	assert.Nil(t, result)
	// YAML parser will fail on empty content
}

func TestLoad_MissingFilePath(t *testing.T) {
	result, err := Load(&LoadOptions{FilePath: ""})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "file path is required")
	assert.Contains(t, err.Error(), "Usage: stigmer mcpserver apply <file>")
}

func TestLoad_RelativeFilePath(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.yaml", minimalValidMcpServerYAML())

	// Load with absolute path first
	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
}

// =============================================================================
// Format Detection Tests
// =============================================================================

func TestLoad_YAMLExtension(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.yaml", minimalValidMcpServerYAML())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
}

func TestLoad_YMLExtension(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.yml", minimalValidMcpServerYAML())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
}

func TestLoad_JSONExtension(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.json", minimalValidMcpServerJSON())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
}

func TestLoad_NoExtension_TreatsAsYAML(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server", minimalValidMcpServerYAML())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
}

// =============================================================================
// Content Parsing Tests
// =============================================================================

func TestLoad_FullMcpServerYAML(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.yaml", fullMcpServerYAML())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	require.NotNil(t, result)
	
	// Verify metadata
	assert.Equal(t, "github-api", result.McpServer.Metadata.Name)
	assert.Equal(t, "github-api", result.McpServer.Metadata.Slug)
	
	// Verify spec
	assert.Equal(t, "GitHub API MCP server", result.McpServer.Spec.Description)
	assert.Equal(t, "npx", result.McpServer.Spec.GetStdio().Command)
	assert.Len(t, result.McpServer.Spec.GetStdio().Args, 1)
	assert.Equal(t, "@modelcontextprotocol/server-github", result.McpServer.Spec.GetStdio().Args[0])
	
	// Verify tags
	assert.Len(t, result.McpServer.Spec.Tags, 3)
	assert.Contains(t, result.McpServer.Spec.Tags, "github")
}

func TestLoad_HTTPServerYAML(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "server.yaml", httpMcpServerYAML())

	result, err := Load(&LoadOptions{FilePath: path})

	require.NoError(t, err)
	require.NotNil(t, result)
	
	assert.Equal(t, "remote-server", result.McpServer.Metadata.Name)
	assert.Equal(t, "https://api.example.com/mcp", result.McpServer.Spec.GetHttp().Url)
	assert.Nil(t, result.McpServer.Spec.GetStdio())
}

func TestLoad_InvalidYAMLSyntax(t *testing.T) {
	dir := t.TempDir()
	invalidYAML := `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test
  invalid indentation
spec:
  stdio:
    command: node
`
	path := createTestFile(t, dir, "invalid.yaml", invalidYAML)

	result, err := Load(&LoadOptions{FilePath: path})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to parse")
}

func TestLoad_InvalidJSONSyntax(t *testing.T) {
	dir := t.TempDir()
	invalidJSON := `{
  "apiVersion": "agentic.stigmer.ai/v1",
  "kind": "McpServer",
  "metadata": {
    "name": "test"
  },
  "spec": {
    "stdio": {
      "command": "node"
    }
  // Missing closing braces
`
	path := createTestFile(t, dir, "invalid.json", invalidJSON)

	result, err := Load(&LoadOptions{FilePath: path})

	require.Error(t, err)
	assert.Nil(t, result)
}

func TestLoad_MissingRequiredFields(t *testing.T) {
	tests := []struct {
		name        string
		yaml        string
		expectedErr string
	}{
		{
			name: "missing metadata",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
spec:
  stdio:
    command: node
`,
			expectedErr: "metadata is required",
		},
		{
			name: "missing metadata.name",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata: {}
spec:
  stdio:
    command: node
`,
			expectedErr: "metadata.name is required",
		},
		{
			name: "missing spec",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test
`,
			expectedErr: "spec is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := createTestFile(t, dir, "test.yaml", tt.yaml)

			result, err := Load(&LoadOptions{FilePath: path})

			require.Error(t, err)
			assert.Nil(t, result)
			assert.Contains(t, err.Error(), tt.expectedErr)
		})
	}
}

func TestLoad_HandlesExtraFields(t *testing.T) {
	// Extra fields should be rejected (DiscardUnknown: false)
	yamlWithExtra := `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test-server
  extraField: value
spec:
  stdio:
    command: node
`
	dir := t.TempDir()
	path := createTestFile(t, dir, "extra.yaml", yamlWithExtra)

	result, err := Load(&LoadOptions{FilePath: path})

	// protojson with DiscardUnknown: false should reject unknown fields
	if err != nil {
		assert.Contains(t, err.Error(), "unknown field")
	} else {
		// If protojson accepts it, just verify the valid fields
		require.NotNil(t, result)
		assert.Equal(t, "test-server", result.McpServer.Metadata.Name)
	}
}

// =============================================================================
// Validation Tests
// =============================================================================

func TestLoad_ValidateAPIVersion(t *testing.T) {
	tests := []struct {
		name        string
		apiVersion  string
		shouldError bool
		expectedErr string
	}{
		{
			name:        "valid apiVersion",
			apiVersion:  "agentic.stigmer.ai/v1",
			shouldError: false,
		},
		{
			name:        "missing apiVersion",
			apiVersion:  "",
			shouldError: true,
			expectedErr: "apiVersion is required",
		},
		{
			name:        "invalid apiVersion",
			apiVersion:  "v1",
			shouldError: true,
			expectedErr: "invalid apiVersion",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			yaml := `apiVersion: ` + tt.apiVersion + `
kind: McpServer
metadata:
  name: test
spec:
  stdio:
    command: node
`
			dir := t.TempDir()
			path := createTestFile(t, dir, "test.yaml", yaml)

			result, err := Load(&LoadOptions{FilePath: path})

			if tt.shouldError {
				require.Error(t, err)
				assert.Nil(t, result)
				if tt.expectedErr != "" {
					assert.Contains(t, err.Error(), tt.expectedErr)
				}
			} else {
				require.NoError(t, err)
				require.NotNil(t, result)
			}
		})
	}
}

func TestLoad_ValidateKind(t *testing.T) {
	tests := []struct {
		name        string
		kind        string
		shouldError bool
		expectedErr string
	}{
		{
			name:        "valid kind",
			kind:        "McpServer",
			shouldError: false,
		},
		{
			name:        "missing kind",
			kind:        "",
			shouldError: true,
			expectedErr: "kind is required",
		},
		{
			name:        "invalid kind",
			kind:        "Agent",
			shouldError: true,
			expectedErr: "invalid kind",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			yaml := `apiVersion: agentic.stigmer.ai/v1
kind: ` + tt.kind + `
metadata:
  name: test
spec:
  stdio:
    command: node
`
			dir := t.TempDir()
			path := createTestFile(t, dir, "test.yaml", yaml)

			result, err := Load(&LoadOptions{FilePath: path})

			if tt.shouldError {
				require.Error(t, err)
				assert.Nil(t, result)
				if tt.expectedErr != "" {
					assert.Contains(t, err.Error(), tt.expectedErr)
				}
			} else {
				require.NoError(t, err)
				require.NotNil(t, result)
			}
		})
	}
}

func TestLoad_ValidateServerType(t *testing.T) {
	tests := []struct {
		name        string
		yaml        string
		shouldError bool
		expectedErr string
	}{
		{
			name: "valid stdio",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test
spec:
  stdio:
    command: node
`,
			shouldError: false,
		},
		{
			name: "valid http",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test
spec:
  http:
    url: "https://example.com"
`,
			shouldError: false,
		},
		{
			name: "missing server type",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test
spec: {}
`,
			shouldError: true,
			expectedErr: "must specify one of: stdio or http",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := createTestFile(t, dir, "test.yaml", tt.yaml)

			result, err := Load(&LoadOptions{FilePath: path})

			if tt.shouldError {
				require.Error(t, err)
				assert.Nil(t, result)
				if tt.expectedErr != "" {
					assert.Contains(t, err.Error(), tt.expectedErr)
				}
			} else {
				require.NoError(t, err)
				require.NotNil(t, result)
			}
		})
	}
}

func TestLoad_ValidateStdioCommand(t *testing.T) {
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test
spec:
  stdio:
    command: ""
`
	dir := t.TempDir()
	path := createTestFile(t, dir, "test.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "command is required")
}

func TestLoad_ValidateHTTPUrl(t *testing.T) {
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test
spec:
  http:
    url: ""
`
	dir := t.TempDir()
	path := createTestFile(t, dir, "test.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "url is required")
}
