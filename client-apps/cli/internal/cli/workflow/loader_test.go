package workflow

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

func minimalValidWorkflowYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello, World!"
`
}

func fullWorkflowYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: code-review-pipeline
  slug: code-review-pipeline
spec:
  description: Automated code review workflow
  document:
    dsl: "1.0.0"
    namespace: ci
    name: code-review
    version: "1.0.0"
  tasks:
    - name: fetch_code
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://api.example.com/code"
      export:
        as: "${.}"
    - name: analyze
      kind: agent_call
      task_config:
        agent: code-reviewer
        message: "Review this code"
      flow:
        then: end
`
}

func minimalValidWorkflowJSON() string {
	return `{
  "apiVersion": "agentic.stigmer.ai/v1",
  "kind": "Workflow",
  "metadata": {
    "name": "test-workflow"
  },
  "spec": {
    "document": {
      "dsl": "1.0.0",
      "namespace": "test",
      "name": "test-workflow",
      "version": "1.0.0"
    },
    "tasks": [
      {
        "name": "set_greeting",
        "kind": "set_vars",
        "task_config": {
          "variables": {
            "greeting": "Hello, World!"
          }
        }
      }
    ]
  }
}`
}

// =============================================================================
// File Resolution Tests
// =============================================================================

func TestLoad_ExplicitPath(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "custom-workflow.yaml", minimalValidWorkflowYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, path, result.SourcePath)
	assert.Equal(t, "test-workflow", result.Workflow.Metadata.Name)
}

func TestLoad_AnyFileName(t *testing.T) {
	dir := t.TempDir()
	// File can have any name - validation is based on content, not filename
	path := createTestFile(t, dir, "my-deployment.yml", minimalValidWorkflowYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, path, result.SourcePath)
	assert.Equal(t, "test-workflow", result.Workflow.Metadata.Name)
}

func TestLoad_FileNotFound(t *testing.T) {
	_, err := Load(&LoadOptions{FilePath: "/nonexistent/path/workflow.yaml"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "file not found")
}

func TestLoad_FilePathRequired(t *testing.T) {
	_, err := Load(&LoadOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "file path is required")
	assert.Contains(t, err.Error(), "stigmer workflow apply <file>")
}

// =============================================================================
// Parsing Tests
// =============================================================================

func TestLoad_ValidYAML(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "workflow.yaml", minimalValidWorkflowYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Workflow.ApiVersion)
	assert.Equal(t, "Workflow", result.Workflow.Kind)
	assert.Equal(t, "test-workflow", result.Workflow.Metadata.Name)
	assert.NotNil(t, result.Workflow.Spec)
	assert.NotNil(t, result.Workflow.Spec.Document)
}

func TestLoad_ValidJSON(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "workflow.json", minimalValidWorkflowJSON())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Workflow.ApiVersion)
	assert.Equal(t, "Workflow", result.Workflow.Kind)
	assert.Equal(t, "test-workflow", result.Workflow.Metadata.Name)
}

func TestLoad_InvalidYAMLSyntax(t *testing.T) {
	dir := t.TempDir()
	invalidYAML := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test
  invalid yaml here: [unclosed bracket
`
	path := createTestFile(t, dir, "workflow.yaml", invalidYAML)

	_, err := Load(&LoadOptions{FilePath: path})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse YAML")
}

func TestLoad_UnknownFieldsRejected(t *testing.T) {
	dir := t.TempDir()
	yamlWithUnknownField := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
  unknownField: "this should be rejected"
`
	path := createTestFile(t, dir, "workflow.yaml", yamlWithUnknownField)

	_, err := Load(&LoadOptions{FilePath: path})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse Workflow configuration")
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
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "wrong kind",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: WrongKind
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "missing metadata",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "missing document",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "invalid DSL version",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "2.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "missing tasks",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks: []
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "missing task name",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "missing task kind",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "missing task_config",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
`,
			errorContains: "workflow validation failed",
		},
		{
			name: "missing document namespace",
			yaml: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`,
			errorContains: "workflow validation failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := createTestFile(t, dir, "workflow.yaml", tt.yaml)

			_, err := Load(&LoadOptions{FilePath: path})
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.errorContains)
		})
	}
}

// =============================================================================
// Success Cases
// =============================================================================

func TestLoad_MinimalValidWorkflow(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "workflow.yaml", minimalValidWorkflowYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Equal(t, "agentic.stigmer.ai/v1", result.Workflow.ApiVersion)
	assert.Equal(t, "Workflow", result.Workflow.Kind)
	assert.NotNil(t, result.Workflow.Metadata)
	assert.Equal(t, "test-workflow", result.Workflow.Metadata.Name)
	assert.NotNil(t, result.Workflow.Spec)
	assert.NotNil(t, result.Workflow.Spec.Document)
	assert.Equal(t, "1.0.0", result.Workflow.Spec.Document.Dsl)
	assert.Equal(t, "test", result.Workflow.Spec.Document.Namespace)
	assert.Equal(t, "test-workflow", result.Workflow.Spec.Document.Name)
	assert.Equal(t, "1.0.0", result.Workflow.Spec.Document.Version)
	assert.Len(t, result.Workflow.Spec.Tasks, 1)
	assert.Equal(t, "set_greeting", result.Workflow.Spec.Tasks[0].Name)
}

func TestLoad_FullWorkflow(t *testing.T) {
	dir := t.TempDir()
	path := createTestFile(t, dir, "workflow.yaml", fullWorkflowYAML())

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Equal(t, "agentic.stigmer.ai/v1", result.Workflow.ApiVersion)
	assert.Equal(t, "Workflow", result.Workflow.Kind)
	assert.Equal(t, "code-review-pipeline", result.Workflow.Metadata.Name)
	assert.Equal(t, "code-review-pipeline", result.Workflow.Metadata.Slug)
	assert.Equal(t, "Automated code review workflow", result.Workflow.Spec.Description)
	assert.Len(t, result.Workflow.Spec.Tasks, 2)

	// Verify first task (http_call)
	task1 := result.Workflow.Spec.Tasks[0]
	assert.Equal(t, "fetch_code", task1.Name)
	assert.NotNil(t, task1.Export)
	assert.Equal(t, "${.}", task1.Export.As)

	// Verify second task (agent_call)
	task2 := result.Workflow.Spec.Tasks[1]
	assert.Equal(t, "analyze", task2.Name)
	assert.NotNil(t, task2.Flow)
	assert.Equal(t, "end", task2.Flow.Then)
}

func TestLoad_MultipleTaskKinds(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: multi-task-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: multi-task
    version: "1.0.0"
  tasks:
    - name: initialize
      kind: set_vars
      task_config:
        variables:
          status: "started"
    - name: fetch_data
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://api.example.com/data"
    - name: process
      kind: agent_call
      task_config:
        agent: data-processor
        message: "Process the data"
    - name: delay
      kind: wait
      task_config:
        seconds: 5
`
	path := createTestFile(t, dir, "workflow.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Len(t, result.Workflow.Spec.Tasks, 4)
	assert.Equal(t, "initialize", result.Workflow.Spec.Tasks[0].Name)
	assert.Equal(t, "fetch_data", result.Workflow.Spec.Tasks[1].Name)
	assert.Equal(t, "process", result.Workflow.Spec.Tasks[2].Name)
	assert.Equal(t, "delay", result.Workflow.Spec.Tasks[3].Name)
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestLoad_EmptyOptionalFields(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: "Hello"
`
	path := createTestFile(t, dir, "workflow.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.NotNil(t, result.Workflow.Spec)
	assert.Empty(t, result.Workflow.Spec.Description)
	assert.Empty(t, result.Workflow.Spec.Env)
}

func TestLoad_YAMLSpecialCharacters(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  description: "Description with special chars: <>&\"'"
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          message: "Special chars: <>&\"'"
`
	path := createTestFile(t, dir, "workflow.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Contains(t, result.Workflow.Spec.Description, "<>&")
}

func TestLoad_MultiLineStrings(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  description: |
    Multi-line description with details:
    - Point 1
    - Point 2
    - Point 3
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: analyze
      kind: agent_call
      task_config:
        agent: analyzer
        message: |
          Please analyze this data:
          - Check for errors
          - Verify format
          - Report findings
`
	path := createTestFile(t, dir, "workflow.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)
	assert.Contains(t, result.Workflow.Spec.Description, "Point 1")
	assert.Contains(t, result.Workflow.Spec.Description, "Point 2")
}

func TestLoad_TaskConfigWithNestedStructs(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: http_request
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "https://api.example.com/webhook"
        headers:
          Content-Type: "application/json"
          Authorization: "Bearer token123"
        body:
          data:
            nested:
              deeply:
                value: "deep value"
          items:
            - name: "item1"
              count: 10
            - name: "item2"
              count: 20
`
	path := createTestFile(t, dir, "workflow.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Len(t, result.Workflow.Spec.Tasks, 1)
	task := result.Workflow.Spec.Tasks[0]
	assert.Equal(t, "http_request", task.Name)
	assert.NotNil(t, task.TaskConfig)
	// TaskConfig is a google.protobuf.Struct, verify it was parsed
	assert.NotNil(t, task.TaskConfig.Fields)
}

func TestLoad_WithExportAndFlowControl(t *testing.T) {
	dir := t.TempDir()
	yaml := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: test-workflow
    version: "1.0.0"
  tasks:
    - name: step1
      kind: set_vars
      task_config:
        variables:
          status: "initialized"
      export:
        as: "${.status}"
      flow:
        then: step2
    - name: step2
      kind: set_vars
      task_config:
        variables:
          status: "completed"
      export:
        as: "${.}"
      flow:
        then: end
`
	path := createTestFile(t, dir, "workflow.yaml", yaml)

	result, err := Load(&LoadOptions{FilePath: path})
	require.NoError(t, err)

	assert.Len(t, result.Workflow.Spec.Tasks, 2)

	task1 := result.Workflow.Spec.Tasks[0]
	assert.Equal(t, "step1", task1.Name)
	assert.NotNil(t, task1.Export)
	assert.Equal(t, "${.status}", task1.Export.As)
	assert.NotNil(t, task1.Flow)
	assert.Equal(t, "step2", task1.Flow.Then)

	task2 := result.Workflow.Spec.Tasks[1]
	assert.Equal(t, "step2", task2.Name)
	assert.NotNil(t, task2.Export)
	assert.Equal(t, "${.}", task2.Export.As)
	assert.NotNil(t, task2.Flow)
	assert.Equal(t, "end", task2.Flow.Then)
}
