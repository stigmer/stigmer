package root

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// resolveApplyFiles
// =============================================================================

func TestResolveApplyFiles_SingleFile(t *testing.T) {
	dir := t.TempDir()
	path := writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	files, err := resolveApplyFiles(path)
	require.NoError(t, err)
	assert.Equal(t, []string{path}, files)
}

func TestResolveApplyFiles_DirectoryReturnsYAMLFiles(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")
	writeResourceYAML(t, dir, "workflow.yml", "Workflow", "my-wf")

	files, err := resolveApplyFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 2)
}

func TestResolveApplyFiles_DirectoryRecursive(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "top-agent")

	subDir := filepath.Join(dir, "sub")
	require.NoError(t, os.MkdirAll(subDir, 0755))
	writeResourceYAML(t, subDir, "nested.yaml", "Agent", "nested-agent")

	files, err := resolveApplyFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 2, "should traverse subdirectories recursively")
}

func TestResolveApplyFiles_DirectorySkipsNonYAML(t *testing.T) {
	dir := t.TempDir()
	writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")
	os.WriteFile(filepath.Join(dir, "readme.md"), []byte("# hello"), 0644)
	os.WriteFile(filepath.Join(dir, "config.json"), []byte("{}"), 0644)

	files, err := resolveApplyFiles(dir)
	require.NoError(t, err)
	assert.Len(t, files, 1)
}

func TestResolveApplyFiles_NonExistentPath(t *testing.T) {
	_, err := resolveApplyFiles("/nonexistent/file.yaml")
	assert.Error(t, err)
}

func TestResolveApplyFiles_EmptyDirectory(t *testing.T) {
	dir := t.TempDir()

	files, err := resolveApplyFiles(dir)
	require.NoError(t, err)
	assert.Empty(t, files)
}

// =============================================================================
// detectApplyItems
// =============================================================================

func TestDetectApplyItems_ValidAgentYAML(t *testing.T) {
	dir := t.TempDir()
	path := writeResourceYAML(t, dir, "agent.yaml", "Agent", "my-agent")

	items, err := detectApplyItems(path)
	require.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, "Agent", items[0].kind)
	assert.Equal(t, path, items[0].filePath)
	assert.NotNil(t, items[0].typeInfo)
	assert.NotEmpty(t, items[0].rawContent)
}

func TestDetectApplyItems_ValidWorkflowYAML(t *testing.T) {
	dir := t.TempDir()
	path := writeResourceYAML(t, dir, "workflow.yaml", "Workflow", "my-wf")

	items, err := detectApplyItems(path)
	require.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, "Workflow", items[0].kind)
}

func TestDetectApplyItems_ValidMcpServerYAML(t *testing.T) {
	dir := t.TempDir()
	path := writeResourceYAML(t, dir, "mcp.yaml", "McpServer", "github-mcp")

	items, err := detectApplyItems(path)
	require.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, "McpServer", items[0].kind)
}

func TestDetectApplyItems_UnknownKindError(t *testing.T) {
	dir := t.TempDir()
	content := `apiVersion: agentic.stigmer.ai/v1
kind: UnknownThing
metadata:
  name: test
`
	path := filepath.Join(dir, "unknown.yaml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0644))

	_, err := detectApplyItems(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "UnknownThing")
}

func TestDetectApplyItems_MultiDocumentYAML(t *testing.T) {
	dir := t.TempDir()
	content := `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: first-agent
spec:
  description: "First agent"
---
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: first-workflow
spec:
  description: "First workflow"
`
	path := filepath.Join(dir, "multi.yaml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0644))

	items, err := detectApplyItems(path)
	require.NoError(t, err)
	assert.Len(t, items, 2)
	assert.Equal(t, "Agent", items[0].kind)
	assert.Equal(t, "Workflow", items[1].kind)
}

func TestDetectApplyItems_NonResourceYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plain.yaml")
	require.NoError(t, os.WriteFile(path, []byte("key: value\n"), 0644))

	items, err := detectApplyItems(path)
	require.NoError(t, err)
	assert.Empty(t, items, "YAML without kind/apiVersion should produce no items")
}
