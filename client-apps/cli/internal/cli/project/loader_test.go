package project

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

func minimalValidProjectYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  description: A test project
`
}

func fullProjectYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-super-app
  org: acme-corp
spec:
  entry_point: main.py
  description: A comprehensive AI platform for automation
`
}

func minimalValidProjectJSON() string {
	return `{
  "apiVersion": "agentic.stigmer.ai/v1",
  "kind": "Project",
  "metadata": {
    "name": "test-project"
  },
  "spec": {
    "description": "A test project"
  }
}`
}

// =============================================================================
// File Resolution Tests
// =============================================================================

func TestLoad_ExplicitPath(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "custom-project.yaml", minimalValidProjectYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, path, result.SourcePath)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
}

func TestLoad_AnyFileName(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "my-config.yml", minimalValidProjectYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, path, result.SourcePath)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
}

func TestLoad_FileNotFound(t *testing.T) {
	_, err := Load(&LoadOptions{FilePath: "/nonexistent/path/project.yaml"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "file not found")
}

func TestLoad_FilePathRequired(t *testing.T) {
	_, err := Load(&LoadOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "file path is required")
	assert.Contains(t, err.Error(), "stigmer project validate <file>")
}

// =============================================================================
// Parsing Tests
// =============================================================================

func TestLoad_ValidYAML(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "project.yaml", minimalValidProjectYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Project.ApiVersion)
	assert.Equal(t, "Project", result.Project.Kind)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
}

func TestLoad_ValidJSON(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "project.json", minimalValidProjectJSON())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Project.ApiVersion)
	assert.Equal(t, "Project", result.Project.Kind)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
}

func TestLoad_InvalidYAMLSyntax(t *testing.T) {
	dir := t.TempDir()
	invalidYAML := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test
  invalid yaml here: [unclosed bracket
`
	path := createTestFile(t, dir, "project.yaml", invalidYAML)

	_, err := Load(&LoadOptions{FilePath: path})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse YAML")
}

func TestLoad_UnknownFieldsRejected(t *testing.T) {
	dir := t.TempDir()
	yamlWithUnknownField := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  description: A test project
  unknownField: "this should be rejected"
`
	path := createTestFile(t, dir, "project.yaml", yamlWithUnknownField)

	_, err := Load(&LoadOptions{FilePath: path})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse Project configuration")
}

func TestLoad_LegacyRuntimeFieldRejected(t *testing.T) {
	dir := t.TempDir()
	legacyYAML := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  runtime: go
  description: A test project
`
	path := createTestFile(t, dir, "project.yaml", legacyYAML)

	_, err := Load(&LoadOptions{FilePath: path})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse Project configuration")
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
kind: Project
metadata:
  name: test-project
spec:
  description: A test project
`,
			errorContains: "project validation failed",
		},
		{
			name: "wrong kind",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: WrongKind
metadata:
  name: test-project
spec:
  description: A test project
`,
			errorContains: "project validation failed",
		},
		{
			name: "missing metadata",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Project
spec:
  description: A test project
`,
			errorContains: "project validation failed",
		},
		{
			name: "missing spec",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
`,
			errorContains: "project validation failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := createTestFile(t, dir, "project.yaml", tt.yaml)

			_, err := Load(&LoadOptions{FilePath: path})
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.errorContains)
		})
	}
}

// =============================================================================
// Success Cases
// =============================================================================

func TestLoad_MinimalValidProject(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "project.yaml", minimalValidProjectYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Equal(t, "agentic.stigmer.ai/v1", result.Project.ApiVersion)
	assert.Equal(t, "Project", result.Project.Kind)
	assert.NotNil(t, result.Project.Metadata)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
	assert.NotNil(t, result.Project.Spec)
	assert.Equal(t, "A test project", result.Project.Spec.Description)
}

func TestLoad_FullProject(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "project.yaml", fullProjectYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Equal(t, "agentic.stigmer.ai/v1", result.Project.ApiVersion)
	assert.Equal(t, "Project", result.Project.Kind)
	assert.Equal(t, "my-super-app", result.Project.Metadata.Name)
	assert.Equal(t, "acme-corp", result.Project.Metadata.Org)
	assert.Equal(t, "main.py", result.Project.Spec.EntryPoint)
	assert.Equal(t, "A comprehensive AI platform for automation", result.Project.Spec.Description)
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestLoad_EmptyEntryPoint(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "project.yaml", minimalValidProjectYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Empty(t, result.Project.Spec.EntryPoint)
}

func TestLoad_EmptyDescription(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  entry_point: main.py
`
	path := createTestFile(t, dir, "project.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Empty(t, result.Project.Spec.Description)
	assert.Equal(t, "main.py", result.Project.Spec.EntryPoint)
}

func TestLoad_YAMLSpecialCharacters(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  entry_point: main.go
  description: "Description with special chars: <>&\"'"
`
	path := createTestFile(t, dir, "project.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Contains(t, result.Project.Spec.Description, "<>&")
}

func TestLoad_MultiLineDescription(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  entry_point: index.ts
  description: |
    Multi-line description for the project.
    This spans multiple lines.
    - Feature 1
    - Feature 2
`
	path := createTestFile(t, dir, "project.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Contains(t, result.Project.Spec.Description, "Multi-line description")
	assert.Contains(t, result.Project.Spec.Description, "Feature 1")
}

func TestLoad_DifferentFileExtensions(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		content  string
	}{
		{name: ".yaml extension", filename: "stigmer.yaml", content: minimalValidProjectYAML()},
		{name: ".yml extension", filename: "stigmer.yml", content: minimalValidProjectYAML()},
		{name: ".json extension", filename: "stigmer.json", content: minimalValidProjectJSON()},
		{name: "no extension (treated as YAML)", filename: "stigmer", content: minimalValidProjectYAML()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := createTestFile(t, dir, tt.filename, tt.content)

			result, err := Load(&LoadOptions{FilePath: path})
			require.NoError(t, err)
			assert.Equal(t, "test-project", result.Project.Metadata.Name)
		})
	}
}
