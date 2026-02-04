package project

import (
	"os"
	"path/filepath"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Test Helpers
// =============================================================================

// createNestedDirs creates a nested directory structure and returns the deepest path.
// depth=1 creates just the base dir, depth=2 creates base/sub1, etc.
func createNestedDirs(t *testing.T, baseDir string, depth int) string {
	t.Helper()
	currentDir := baseDir
	for i := 1; i < depth; i++ {
		currentDir = filepath.Join(currentDir, "subdir")
		err := os.MkdirAll(currentDir, 0755)
		require.NoError(t, err)
	}
	return currentDir
}

// createStigmerYAML creates a stigmer.yaml file in the specified directory.
func createStigmerYAML(t *testing.T, dir, content string) string {
	t.Helper()
	path := filepath.Join(dir, ConfigFileName)
	err := os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
	return path
}

// minimalValidStigmerYAML returns a minimal valid stigmer.yaml content.
func minimalValidStigmerYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  runtime: go
`
}

// fullValidStigmerYAML returns a complete stigmer.yaml with all fields.
func fullValidStigmerYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-awesome-project
  org: acme-corp
spec:
  runtime: python
  entry_point: main.py
  description: A comprehensive project for testing
`
}

// invalidStigmerYAML returns invalid content for various error scenarios.
func invalidStigmerYAML(variant string) string {
	switch variant {
	case "wrong-api-version":
		return `apiVersion: wrong/v1
kind: Project
metadata:
  name: test
spec:
  runtime: go
`
	case "wrong-kind":
		return `apiVersion: agentic.stigmer.ai/v1
kind: WrongKind
metadata:
  name: test
spec:
  runtime: go
`
	case "missing-runtime":
		return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test
spec:
  description: no runtime
`
	case "malformed-yaml":
		return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test
  invalid: [unclosed bracket
`
	default:
		return ""
	}
}

// =============================================================================
// Default Behavior Tests
// =============================================================================

func TestDetectTrack_DefaultsToCurrentDirectory(t *testing.T) {
	// Create a temp dir with stigmer.yaml and change to it
	dir := t.TempDir()
	createStigmerYAML(t, dir, minimalValidStigmerYAML())

	// Resolve symlinks (macOS /var -> /private/var)
	resolvedDir, err := filepath.EvalSymlinks(dir)
	require.NoError(t, err)

	// Save current dir and change to test dir
	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalDir) }()
	err = os.Chdir(dir)
	require.NoError(t, err)

	// Detect with nil options should use cwd
	result, err := DetectTrack(nil)
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, filepath.Join(resolvedDir, ConfigFileName), result.ConfigPath)
}

func TestDetectTrack_DefaultMaxDepth(t *testing.T) {
	// Create a deeply nested structure (deeper than default max depth)
	baseDir := t.TempDir()
	deepDir := createNestedDirs(t, baseDir, 15) // 15 levels deep

	// No stigmer.yaml anywhere - should return Atomic without error
	result, err := DetectTrack(&DetectOptions{StartDir: deepDir})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)
}

func TestDetectTrack_EmptyOptionsUsesDefaults(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, minimalValidStigmerYAML())

	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalDir) }()
	err = os.Chdir(dir)
	require.NoError(t, err)

	// Empty options should behave like nil options
	result, err := DetectTrack(&DetectOptions{})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
}

// =============================================================================
// Walk-Up Discovery Tests
// =============================================================================

func TestDetectTrack_FindsConfigInCurrentDir(t *testing.T) {
	dir := t.TempDir()
	configPath := createStigmerYAML(t, dir, minimalValidStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, dir, result.ConfigDir)
}

func TestDetectTrack_FindsConfigInParentDir(t *testing.T) {
	baseDir := t.TempDir()
	configPath := createStigmerYAML(t, baseDir, minimalValidStigmerYAML())

	// Create a subdirectory to start from
	subDir := filepath.Join(baseDir, "subdir")
	err := os.MkdirAll(subDir, 0755)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: subDir})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, baseDir, result.ConfigDir)
}

func TestDetectTrack_FindsConfigMultipleLevelsUp(t *testing.T) {
	baseDir := t.TempDir()
	configPath := createStigmerYAML(t, baseDir, minimalValidStigmerYAML())

	// Create 5-level deep subdirectory
	deepDir := createNestedDirs(t, baseDir, 5)

	result, err := DetectTrack(&DetectOptions{StartDir: deepDir})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, baseDir, result.ConfigDir)
}

func TestDetectTrack_RespectsMaxDepthLimit(t *testing.T) {
	baseDir := t.TempDir()
	createStigmerYAML(t, baseDir, minimalValidStigmerYAML())

	// Create subdirectory 3 levels deep
	deepDir := createNestedDirs(t, baseDir, 3)

	// With MaxDepth=2, should not find config 3 levels up
	result, err := DetectTrack(&DetectOptions{StartDir: deepDir, MaxDepth: 2})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)

	// With MaxDepth=4, should find it
	result, err = DetectTrack(&DetectOptions{StartDir: deepDir, MaxDepth: 4})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
}

func TestDetectTrack_FindsClosestConfig(t *testing.T) {
	baseDir := t.TempDir()
	createStigmerYAML(t, baseDir, fullValidStigmerYAML()) // "my-awesome-project"

	// Create subdirectory with its own stigmer.yaml
	subDir := filepath.Join(baseDir, "nested-project")
	err := os.MkdirAll(subDir, 0755)
	require.NoError(t, err)
	closerConfig := createStigmerYAML(t, subDir, minimalValidStigmerYAML()) // "test-project"

	// Start from subDir - should find the closer config
	result, err := DetectTrack(&DetectOptions{StartDir: subDir})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, closerConfig, result.ConfigPath)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
}

// =============================================================================
// Atomic Track Tests
// =============================================================================

func TestDetectTrack_ReturnsAtomicWhenNoConfig(t *testing.T) {
	dir := t.TempDir()

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)
	assert.Empty(t, result.ConfigPath)
	assert.Empty(t, result.ConfigDir)
	assert.Nil(t, result.Project)
}

func TestDetectTrack_ReturnsAtomicWhenMaxDepthExceeded(t *testing.T) {
	baseDir := t.TempDir()
	createStigmerYAML(t, baseDir, minimalValidStigmerYAML())

	// Create deep subdirectory
	deepDir := createNestedDirs(t, baseDir, 5)

	// MaxDepth=1 means only check start dir
	result, err := DetectTrack(&DetectOptions{StartDir: deepDir, MaxDepth: 1})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)
}

func TestDetectTrack_AtomicResultHasEmptyFields(t *testing.T) {
	dir := t.TempDir()

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	assert.Equal(t, TrackAtomic, result.Track)
	assert.Equal(t, "", result.ConfigPath, "ConfigPath should be empty for Atomic")
	assert.Equal(t, "", result.ConfigDir, "ConfigDir should be empty for Atomic")
	assert.Nil(t, result.Project, "Project should be nil for Atomic")
}

// =============================================================================
// Project Track Tests
// =============================================================================

func TestDetectTrack_ProjectTrackWithValidConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := createStigmerYAML(t, dir, minimalValidStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, dir, result.ConfigDir)
	assert.NotNil(t, result.Project)
}

func TestDetectTrack_ConfigPathIsAbsolute(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, minimalValidStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	assert.True(t, filepath.IsAbs(result.ConfigPath), "ConfigPath should be absolute")
	assert.True(t, filepath.IsAbs(result.ConfigDir), "ConfigDir should be absolute")
}

func TestDetectTrack_ProjectIsPopulated(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, fullValidStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	require.NotNil(t, result.Project)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Project.ApiVersion)
	assert.Equal(t, "Project", result.Project.Kind)
	assert.Equal(t, "my-awesome-project", result.Project.Metadata.Name)
	assert.Equal(t, "acme-corp", result.Project.Metadata.Org)
	assert.Equal(t, projectv1.ProjectRuntime_python, result.Project.Spec.Runtime)
	assert.Equal(t, "main.py", result.Project.Spec.EntryPoint)
	assert.Equal(t, "A comprehensive project for testing", result.Project.Spec.Description)
}

func TestDetectTrack_AllRuntimes(t *testing.T) {
	tests := []struct {
		name     string
		runtime  string
		expected projectv1.ProjectRuntime
	}{
		{"go", "go", projectv1.ProjectRuntime_go},
		{"python", "python", projectv1.ProjectRuntime_python},
		{"node", "node", projectv1.ProjectRuntime_node},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			content := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test
spec:
  runtime: ` + tt.runtime
			createStigmerYAML(t, dir, content)

			result, err := DetectTrack(&DetectOptions{StartDir: dir})
			require.NoError(t, err)
			assert.Equal(t, tt.expected, result.Project.Spec.Runtime)
		})
	}
}

// =============================================================================
// Validation Error Tests
// =============================================================================

func TestDetectTrack_InvalidApiVersionReturnsError(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, invalidStigmerYAML("wrong-api-version"))

	_, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project configuration")
	assert.Contains(t, err.Error(), "stigmer.yaml")
}

func TestDetectTrack_InvalidKindReturnsError(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, invalidStigmerYAML("wrong-kind"))

	_, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project configuration")
}

func TestDetectTrack_MissingRuntimeReturnsError(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, invalidStigmerYAML("missing-runtime"))

	_, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project configuration")
}

func TestDetectTrack_MalformedYAMLReturnsError(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, invalidStigmerYAML("malformed-yaml"))

	_, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid project configuration")
}

func TestDetectTrack_ErrorIncludesFixGuidance(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, invalidStigmerYAML("wrong-api-version"))

	_, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Fix the issues")
	assert.Contains(t, err.Error(), "Atomic Track")
}

func TestDetectTrack_ErrorIncludesFilePath(t *testing.T) {
	dir := t.TempDir()
	configPath := createStigmerYAML(t, dir, invalidStigmerYAML("wrong-kind"))

	_, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.Error(t, err)
	assert.Contains(t, err.Error(), configPath)
}

// =============================================================================
// Edge Case Tests
// =============================================================================

func TestDetectTrack_IgnoresCaseSensitive(t *testing.T) {
	dir := t.TempDir()

	// Detect if filesystem is case-sensitive by creating two files with
	// different cases and checking if they're different.
	testFile1 := filepath.Join(dir, "TESTCASE")
	testFile2 := filepath.Join(dir, "testcase")
	err := os.WriteFile(testFile1, []byte("1"), 0644)
	require.NoError(t, err)
	err = os.WriteFile(testFile2, []byte("2"), 0644)
	require.NoError(t, err)
	content1, _ := os.ReadFile(testFile1)
	content2, _ := os.ReadFile(testFile2)
	isCaseSensitive := string(content1) == "1" && string(content2) == "2"

	if !isCaseSensitive {
		t.Skip("Skipping case-sensitivity test on case-insensitive filesystem (e.g., macOS)")
	}

	// Clean up test files
	_ = os.Remove(testFile1)
	_ = os.Remove(testFile2)

	// Create STIGMER.yaml (wrong case) - should be ignored on case-sensitive fs
	wrongCasePath := filepath.Join(dir, "STIGMER.yaml")
	err = os.WriteFile(wrongCasePath, []byte(minimalValidStigmerYAML()), 0644)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track, "STIGMER.yaml should be ignored on case-sensitive filesystem")
}

func TestDetectTrack_IgnoresDirectory(t *testing.T) {
	dir := t.TempDir()

	// Create a directory named stigmer.yaml (should be ignored)
	dirPath := filepath.Join(dir, ConfigFileName)
	err := os.MkdirAll(dirPath, 0755)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track, "directory named stigmer.yaml should be ignored")
}

func TestDetectTrack_NonExistentStartDir(t *testing.T) {
	_, err := DetectTrack(&DetectOptions{StartDir: "/nonexistent/path/that/does/not/exist"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}

func TestDetectTrack_StartDirIsFile(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "not-a-dir.txt")
	err := os.WriteFile(filePath, []byte("content"), 0644)
	require.NoError(t, err)

	_, err = DetectTrack(&DetectOptions{StartDir: filePath})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a directory")
}

func TestDetectTrack_RelativeStartDir(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, minimalValidStigmerYAML())

	// Change to parent and use relative path
	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalDir) }()

	parent := filepath.Dir(dir)
	err = os.Chdir(parent)
	require.NoError(t, err)

	relPath := filepath.Base(dir)
	result, err := DetectTrack(&DetectOptions{StartDir: relPath})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
	assert.True(t, filepath.IsAbs(result.ConfigPath), "ConfigPath should be absolute even with relative StartDir")
}

func TestDetectTrack_MaxDepthOne(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, minimalValidStigmerYAML())

	// Create subdirectory
	subDir := filepath.Join(dir, "sub")
	err := os.MkdirAll(subDir, 0755)
	require.NoError(t, err)

	// MaxDepth=1 should only check start dir
	result, err := DetectTrack(&DetectOptions{StartDir: subDir, MaxDepth: 1})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)

	// MaxDepth=2 should find it in parent
	result, err = DetectTrack(&DetectOptions{StartDir: subDir, MaxDepth: 2})
	require.NoError(t, err)
	assert.Equal(t, TrackProject, result.Track)
}

// =============================================================================
// Integration Tests
// =============================================================================

func TestDetectTrack_FullProjectFlow(t *testing.T) {
	// Create a realistic project structure
	projectRoot := t.TempDir()
	createStigmerYAML(t, projectRoot, fullValidStigmerYAML())

	// Create typical project subdirectories
	srcDir := filepath.Join(projectRoot, "src", "agents")
	err := os.MkdirAll(srcDir, 0755)
	require.NoError(t, err)

	// Detect from deep inside src/agents
	result, err := DetectTrack(&DetectOptions{StartDir: srcDir})
	require.NoError(t, err)

	// Verify full result
	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, filepath.Join(projectRoot, ConfigFileName), result.ConfigPath)
	assert.Equal(t, projectRoot, result.ConfigDir)
	require.NotNil(t, result.Project)
	assert.Equal(t, "my-awesome-project", result.Project.Metadata.Name)
	assert.Equal(t, projectv1.ProjectRuntime_python, result.Project.Spec.Runtime)
}

func TestDetectTrack_AtomicFlowForSingleResource(t *testing.T) {
	// Simulate a user with a single agent.yaml, no project
	userDir := t.TempDir()

	// Create agent.yaml but no stigmer.yaml
	agentPath := filepath.Join(userDir, "agent.yaml")
	err := os.WriteFile(agentPath, []byte("apiVersion: ...\nkind: Agent"), 0644)
	require.NoError(t, err)

	// Detection should return Atomic
	result, err := DetectTrack(&DetectOptions{StartDir: userDir})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)
	assert.Empty(t, result.ConfigPath)
	assert.Nil(t, result.Project)
}

// =============================================================================
// Track String Tests
// =============================================================================

func TestTrack_String(t *testing.T) {
	assert.Equal(t, "atomic", TrackAtomic.String())
	assert.Equal(t, "project", TrackProject.String())
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestIsFilesystemRoot(t *testing.T) {
	// Unix root
	assert.True(t, isFilesystemRoot("/"))

	// Non-root paths
	assert.False(t, isFilesystemRoot("/home"))
	assert.False(t, isFilesystemRoot("/home/user"))
	assert.False(t, isFilesystemRoot("/tmp/test"))
}
