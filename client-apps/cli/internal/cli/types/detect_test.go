package types

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetect_SingleDocument(t *testing.T) {
	content := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
spec:
  instructions: "Test instructions"
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "agent.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := Detect(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Kind != "Agent" {
		t.Errorf("expected kind Agent, got %s", result.Kind)
	}
	if result.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("expected apiVersion agentic.stigmer.ai/v1, got %s", result.ApiVersion)
	}
	if result.FilePath != filePath {
		t.Errorf("expected filePath %s, got %s", filePath, result.FilePath)
	}
}

func TestDetect_McpServer(t *testing.T) {
	content := `apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: test-server
spec:
  transport:
    stdio:
      command: "node"
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "mcpserver.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := Detect(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Kind != "McpServer" {
		t.Errorf("expected kind McpServer, got %s", result.Kind)
	}
}

func TestDetect_Workflow(t *testing.T) {
	content := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-workflow
spec:
  document:
    name: test
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "workflow.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := Detect(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Kind != "Workflow" {
		t.Errorf("expected kind Workflow, got %s", result.Kind)
	}
}

func TestDetect_Project(t *testing.T) {
	content := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-project
spec:
  runtime: go
  entry_point: main.go
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "stigmer.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := Detect(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Kind != "Project" {
		t.Errorf("expected kind Project, got %s", result.Kind)
	}
}

func TestDetectMulti_MultipleDocuments(t *testing.T) {
	content := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: agent-1
---
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: workflow-1
---
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: server-1
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "multi.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	results, err := DetectMulti(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(results) != 3 {
		t.Fatalf("expected 3 documents, got %d", len(results))
	}

	expectedKinds := []string{"Agent", "Workflow", "McpServer"}
	for i, result := range results {
		if result.Kind != expectedKinds[i] {
			t.Errorf("document %d: expected kind %s, got %s", i, expectedKinds[i], result.Kind)
		}
	}
}

func TestDetectMulti_SkipsEmptyDocuments(t *testing.T) {
	content := `---
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: agent-1
---
---
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: workflow-1
---
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "multi-empty.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	results, err := DetectMulti(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(results) != 2 {
		t.Fatalf("expected 2 documents (empty ones skipped), got %d", len(results))
	}
}

func TestDetectMulti_SkipsDocumentsWithoutKind(t *testing.T) {
	content := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: agent-1
---
# This is just a comment document
foo: bar
---
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: workflow-1
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "mixed.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	results, err := DetectMulti(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(results) != 2 {
		t.Fatalf("expected 2 documents (one without kind skipped), got %d", len(results))
	}
}

func TestDetect_FileNotFound(t *testing.T) {
	_, err := Detect("/nonexistent/path/file.yaml")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestDetect_EmptyFile(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "empty.yaml")
	if err := os.WriteFile(filePath, []byte(""), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	_, err := Detect(filePath)
	if err == nil {
		t.Error("expected error for empty file")
	}
}

func TestDetectFromReader(t *testing.T) {
	content := []byte(`apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
`)

	result, err := DetectFromReader(content, "memory://test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Kind != "Agent" {
		t.Errorf("expected kind Agent, got %s", result.Kind)
	}
	if result.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("expected apiVersion agentic.stigmer.ai/v1, got %s", result.ApiVersion)
	}
}

func TestDetect_RawContentPreserved(t *testing.T) {
	content := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: test-agent
spec:
  instructions: "Test instructions"
`

	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "agent.yaml")
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	result, err := Detect(filePath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.RawContent) == 0 {
		t.Error("expected RawContent to be preserved")
	}
}
