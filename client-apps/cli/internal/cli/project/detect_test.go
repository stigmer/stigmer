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

// declarativeStigmerYAML returns a minimal valid stigmer.yaml for declarative track
// (no entry_point).
func declarativeStigmerYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test-project
spec:
  description: A test project
`
}

// sdkStigmerYAML returns a stigmer.yaml for SDK track (with entry_point).
func sdkStigmerYAML() string {
	return `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-awesome-project
  org: acme-corp
spec:
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
  description: test
`
	case "wrong-kind":
		return `apiVersion: agentic.stigmer.ai/v1
kind: WrongKind
metadata:
  name: test
spec:
  description: test
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
	dir := t.TempDir()
	createStigmerYAML(t, dir, declarativeStigmerYAML())

	resolvedDir, err := filepath.EvalSymlinks(dir)
	require.NoError(t, err)

	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalDir) }()
	err = os.Chdir(dir)
	require.NoError(t, err)

	result, err := DetectTrack(nil)
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
	assert.Equal(t, filepath.Join(resolvedDir, ConfigFileName), result.ConfigPath)
}

func TestDetectTrack_DefaultMaxDepth(t *testing.T) {
	baseDir := t.TempDir()
	deepDir := createNestedDirs(t, baseDir, 15)

	result, err := DetectTrack(&DetectOptions{StartDir: deepDir})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)
}

func TestDetectTrack_EmptyOptionsUsesDefaults(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, declarativeStigmerYAML())

	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalDir) }()
	err = os.Chdir(dir)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
}

// =============================================================================
// Walk-Up Discovery Tests
// =============================================================================

func TestDetectTrack_FindsConfigInCurrentDir(t *testing.T) {
	dir := t.TempDir()
	configPath := createStigmerYAML(t, dir, declarativeStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, dir, result.ConfigDir)
}

func TestDetectTrack_FindsConfigInParentDir(t *testing.T) {
	baseDir := t.TempDir()
	configPath := createStigmerYAML(t, baseDir, declarativeStigmerYAML())

	subDir := filepath.Join(baseDir, "subdir")
	err := os.MkdirAll(subDir, 0755)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: subDir})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, baseDir, result.ConfigDir)
}

func TestDetectTrack_FindsConfigMultipleLevelsUp(t *testing.T) {
	baseDir := t.TempDir()
	configPath := createStigmerYAML(t, baseDir, declarativeStigmerYAML())

	deepDir := createNestedDirs(t, baseDir, 5)

	result, err := DetectTrack(&DetectOptions{StartDir: deepDir})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, baseDir, result.ConfigDir)
}

func TestDetectTrack_RespectsMaxDepthLimit(t *testing.T) {
	baseDir := t.TempDir()
	createStigmerYAML(t, baseDir, declarativeStigmerYAML())

	deepDir := createNestedDirs(t, baseDir, 3)

	result, err := DetectTrack(&DetectOptions{StartDir: deepDir, MaxDepth: 2})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)

	result, err = DetectTrack(&DetectOptions{StartDir: deepDir, MaxDepth: 4})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
}

func TestDetectTrack_FindsClosestConfig(t *testing.T) {
	baseDir := t.TempDir()
	createStigmerYAML(t, baseDir, sdkStigmerYAML())

	subDir := filepath.Join(baseDir, "nested-project")
	err := os.MkdirAll(subDir, 0755)
	require.NoError(t, err)
	closerConfig := createStigmerYAML(t, subDir, declarativeStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: subDir})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
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
	createStigmerYAML(t, baseDir, declarativeStigmerYAML())

	deepDir := createNestedDirs(t, baseDir, 5)

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
// Declarative Track Tests
// =============================================================================

func TestDetectTrack_DeclarativeWhenNoEntryPoint(t *testing.T) {
	dir := t.TempDir()
	configPath := createStigmerYAML(t, dir, declarativeStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	assert.Equal(t, TrackDeclarative, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, dir, result.ConfigDir)
	assert.NotNil(t, result.Project)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
	assert.Equal(t, "", result.Project.Spec.EntryPoint)
	assert.Equal(t, "A test project", result.Project.Spec.Description)
}

func TestDetectTrack_DeclarativeConfigPathIsAbsolute(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, declarativeStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	assert.True(t, filepath.IsAbs(result.ConfigPath), "ConfigPath should be absolute")
	assert.True(t, filepath.IsAbs(result.ConfigDir), "ConfigDir should be absolute")
}

// =============================================================================
// SDK (Project) Track Tests
// =============================================================================

func TestDetectTrack_ProjectWhenEntryPointSet(t *testing.T) {
	dir := t.TempDir()
	configPath := createStigmerYAML(t, dir, sdkStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, configPath, result.ConfigPath)
	assert.Equal(t, dir, result.ConfigDir)
	assert.NotNil(t, result.Project)
	assert.Equal(t, "my-awesome-project", result.Project.Metadata.Name)
	assert.Equal(t, "acme-corp", result.Project.Metadata.Org)
	assert.Equal(t, "main.py", result.Project.Spec.EntryPoint)
	assert.Equal(t, "A comprehensive project for testing", result.Project.Spec.Description)
}

func TestDetectTrack_ProjectIsPopulated(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, sdkStigmerYAML())

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)

	require.NotNil(t, result.Project)
	assert.Equal(t, "agentic.stigmer.ai/v1", result.Project.ApiVersion)
	assert.Equal(t, "Project", result.Project.Kind)
	assert.Equal(t, "my-awesome-project", result.Project.Metadata.Name)
	assert.Equal(t, "acme-corp", result.Project.Metadata.Org)
	assert.Equal(t, "main.py", result.Project.Spec.EntryPoint)
	assert.Equal(t, "A comprehensive project for testing", result.Project.Spec.Description)
}

func TestDetectTrack_EntryPointVariants(t *testing.T) {
	tests := []struct {
		name       string
		entryPoint string
	}{
		{"go", "main.go"},
		{"python", "main.py"},
		{"typescript", "index.ts"},
		{"javascript", "index.js"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			content := `apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: test
spec:
  entry_point: ` + tt.entryPoint + `
  description: test`
			createStigmerYAML(t, dir, content)

			result, err := DetectTrack(&DetectOptions{StartDir: dir})
			require.NoError(t, err)
			assert.Equal(t, TrackProject, result.Track)
			assert.Equal(t, tt.entryPoint, result.Project.Spec.EntryPoint)
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

	_ = os.Remove(testFile1)
	_ = os.Remove(testFile2)

	wrongCasePath := filepath.Join(dir, "STIGMER.yaml")
	err = os.WriteFile(wrongCasePath, []byte(declarativeStigmerYAML()), 0644)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: dir})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track, "STIGMER.yaml should be ignored on case-sensitive filesystem")
}

func TestDetectTrack_IgnoresDirectory(t *testing.T) {
	dir := t.TempDir()

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
	createStigmerYAML(t, dir, declarativeStigmerYAML())

	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer func() { _ = os.Chdir(originalDir) }()

	parent := filepath.Dir(dir)
	err = os.Chdir(parent)
	require.NoError(t, err)

	relPath := filepath.Base(dir)
	result, err := DetectTrack(&DetectOptions{StartDir: relPath})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
	assert.True(t, filepath.IsAbs(result.ConfigPath), "ConfigPath should be absolute even with relative StartDir")
}

func TestDetectTrack_MaxDepthOne(t *testing.T) {
	dir := t.TempDir()
	createStigmerYAML(t, dir, declarativeStigmerYAML())

	subDir := filepath.Join(dir, "sub")
	err := os.MkdirAll(subDir, 0755)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: subDir, MaxDepth: 1})
	require.NoError(t, err)
	assert.Equal(t, TrackAtomic, result.Track)

	result, err = DetectTrack(&DetectOptions{StartDir: subDir, MaxDepth: 2})
	require.NoError(t, err)
	assert.Equal(t, TrackDeclarative, result.Track)
}

// =============================================================================
// Integration Tests
// =============================================================================

func TestDetectTrack_FullDeclarativeFlow(t *testing.T) {
	projectRoot := t.TempDir()
	createStigmerYAML(t, projectRoot, declarativeStigmerYAML())

	srcDir := filepath.Join(projectRoot, "agents")
	err := os.MkdirAll(srcDir, 0755)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: srcDir})
	require.NoError(t, err)

	assert.Equal(t, TrackDeclarative, result.Track)
	assert.Equal(t, filepath.Join(projectRoot, ConfigFileName), result.ConfigPath)
	assert.Equal(t, projectRoot, result.ConfigDir)
	require.NotNil(t, result.Project)
	assert.Equal(t, "test-project", result.Project.Metadata.Name)
	assert.Equal(t, "", result.Project.Spec.EntryPoint)
}

func TestDetectTrack_FullSDKFlow(t *testing.T) {
	projectRoot := t.TempDir()
	createStigmerYAML(t, projectRoot, sdkStigmerYAML())

	srcDir := filepath.Join(projectRoot, "src", "agents")
	err := os.MkdirAll(srcDir, 0755)
	require.NoError(t, err)

	result, err := DetectTrack(&DetectOptions{StartDir: srcDir})
	require.NoError(t, err)

	assert.Equal(t, TrackProject, result.Track)
	assert.Equal(t, filepath.Join(projectRoot, ConfigFileName), result.ConfigPath)
	assert.Equal(t, projectRoot, result.ConfigDir)
	require.NotNil(t, result.Project)
	assert.Equal(t, "my-awesome-project", result.Project.Metadata.Name)
}

func TestDetectTrack_AtomicFlowForSingleResource(t *testing.T) {
	userDir := t.TempDir()

	agentPath := filepath.Join(userDir, "agent.yaml")
	err := os.WriteFile(agentPath, []byte("apiVersion: ...\nkind: Agent"), 0644)
	require.NoError(t, err)

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
	assert.Equal(t, "declarative", TrackDeclarative.String())
	assert.Equal(t, "project", TrackProject.String())
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestIsFilesystemRoot(t *testing.T) {
	assert.True(t, isFilesystemRoot("/"))

	assert.False(t, isFilesystemRoot("/home"))
	assert.False(t, isFilesystemRoot("/home/user"))
	assert.False(t, isFilesystemRoot("/tmp/test"))
}
