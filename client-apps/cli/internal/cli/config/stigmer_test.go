package config

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

func createTestStigmerYAML(t *testing.T, dir string, content string) string {
	t.Helper()
	path := filepath.Join(dir, DefaultStigmerConfigFilename)
	err := os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
	return path
}

func minimalValidStigmerYAML() string {
	return `name: test-project
runtime: go
main: main.go
`
}

func fullStigmerYAML() string {
	return `name: my-super-app
runtime: go
version: 1.0.0
main: custom.go
organization: my-org
`
}

// =============================================================================
// File Loading Tests
// =============================================================================

func TestLoadStigmerConfig_ValidYAML(t *testing.T) {
	dir := t.TempDir()
	createTestStigmerYAML(t, dir, minimalValidStigmerYAML())

	config, err := LoadStigmerConfig(dir)

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, "test-project", config.Name)
	assert.Equal(t, "go", config.Runtime)
	assert.Equal(t, "main.go", config.Main)
	assert.Equal(t, dir, config.BaseDir)
}

func TestLoadStigmerConfig_FullConfig(t *testing.T) {
	dir := t.TempDir()
	createTestStigmerYAML(t, dir, fullStigmerYAML())

	config, err := LoadStigmerConfig(dir)

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, "my-super-app", config.Name)
	assert.Equal(t, "go", config.Runtime)
	assert.Equal(t, "1.0.0", config.Version)
	assert.Equal(t, "custom.go", config.Main)
	assert.Equal(t, "my-org", config.Organization)
}

func TestLoadStigmerConfig_FileNotFound(t *testing.T) {
	dir := t.TempDir()

	config, err := LoadStigmerConfig(dir)

	require.Error(t, err)
	assert.Nil(t, config)
	assert.Contains(t, err.Error(), "Stigmer.yaml not found")
	assert.Contains(t, err.Error(), "stigmer new") // Check for helpful guidance
}

func TestLoadStigmerConfig_DirectoryPath(t *testing.T) {
	dir := t.TempDir()
	createTestStigmerYAML(t, dir, minimalValidStigmerYAML())

	// Load by directory path
	config, err := LoadStigmerConfig(dir)

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, "test-project", config.Name)
}

func TestLoadStigmerConfig_InvalidYAMLSyntax(t *testing.T) {
	dir := t.TempDir()
	invalidYAML := `name: test
runtime: [unclosed list
main: main.go
`
	createTestStigmerYAML(t, dir, invalidYAML)

	config, err := LoadStigmerConfig(dir)

	require.Error(t, err)
	assert.Nil(t, config)
	// Either parse error or validation error due to invalid runtime format
}

// =============================================================================
// Validation Tests
// =============================================================================

func TestStigmerConfig_Validate_MissingName(t *testing.T) {
	dir := t.TempDir()
	yaml := `runtime: go
main: main.go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	require.Error(t, err)
	assert.Nil(t, config)
	assert.Contains(t, err.Error(), "'name' is required")
}

func TestStigmerConfig_Validate_MissingRuntime(t *testing.T) {
	dir := t.TempDir()
	yaml := `name: test-project
main: main.go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	require.Error(t, err)
	assert.Nil(t, config)
	assert.Contains(t, err.Error(), "'runtime' is required")
}

func TestStigmerConfig_Validate_InvalidRuntime(t *testing.T) {
	tests := []struct {
		name     string
		runtime  string
		expected string
	}{
		{
			name:     "ruby not supported",
			runtime:  "ruby",
			expected: "unsupported runtime",
		},
		{
			name:     "java not supported",
			runtime:  "java",
			expected: "unsupported runtime",
		},
		{
			name:     "empty runtime",
			runtime:  "",
			expected: "'runtime' is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			yaml := `name: test-project
runtime: ` + tt.runtime + `
main: main.go
`
			createTestStigmerYAML(t, dir, yaml)

			config, err := LoadStigmerConfig(dir)

			require.Error(t, err)
			assert.Nil(t, config)
			assert.Contains(t, err.Error(), tt.expected)
		})
	}
}

func TestStigmerConfig_Validate_ValidGoRuntime(t *testing.T) {
	dir := t.TempDir()
	yaml := `name: test-project
runtime: go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	require.NoError(t, err)
	require.NotNil(t, config)
	assert.Equal(t, "go", config.Runtime)
	// Check default main file is set
	assert.Equal(t, "main.go", config.Main)
}

// =============================================================================
// SetDefaults Tests
// =============================================================================

func TestStigmerConfig_SetDefaults_MainForGo(t *testing.T) {
	dir := t.TempDir()
	yaml := `name: test-project
runtime: go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	require.NoError(t, err)
	assert.Equal(t, "main.go", config.Main)
}

func TestStigmerConfig_SetDefaults_PreservesExistingMain(t *testing.T) {
	dir := t.TempDir()
	yaml := `name: test-project
runtime: go
main: custom.go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	require.NoError(t, err)
	// Should preserve custom main, not override with default
	assert.Equal(t, "custom.go", config.Main)
}

// =============================================================================
// Path Resolution Tests
// =============================================================================

func TestStigmerConfig_GetMainFilePath(t *testing.T) {
	dir := t.TempDir()
	createTestStigmerYAML(t, dir, minimalValidStigmerYAML())

	config, err := LoadStigmerConfig(dir)
	require.NoError(t, err)

	mainPath, err := config.GetMainFilePath()
	require.NoError(t, err)

	// Should return absolute path
	assert.True(t, filepath.IsAbs(mainPath))
	assert.Equal(t, filepath.Join(dir, "main.go"), mainPath)
}

func TestStigmerConfig_GetMainFilePath_RelativeMain(t *testing.T) {
	dir := t.TempDir()
	yaml := `name: test-project
runtime: go
main: src/main.go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)
	require.NoError(t, err)

	mainPath, err := config.GetMainFilePath()
	require.NoError(t, err)

	// Should resolve relative to BaseDir
	assert.Equal(t, filepath.Join(dir, "src/main.go"), mainPath)
}

func TestInStigmerProjectDirectory_True(t *testing.T) {
	dir := t.TempDir()
	createTestStigmerYAML(t, dir, minimalValidStigmerYAML())

	// Change to temp dir
	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer os.Chdir(originalDir)

	err = os.Chdir(dir)
	require.NoError(t, err)

	inProject := InStigmerProjectDirectory()
	assert.True(t, inProject)
}

func TestInStigmerProjectDirectory_False(t *testing.T) {
	dir := t.TempDir()
	// No Stigmer.yaml in this dir

	// Change to temp dir
	originalDir, err := os.Getwd()
	require.NoError(t, err)
	defer os.Chdir(originalDir)

	err = os.Chdir(dir)
	require.NoError(t, err)

	inProject := InStigmerProjectDirectory()
	assert.False(t, inProject)
}

// =============================================================================
// WriteStigmerConfig Tests
// =============================================================================

func TestWriteStigmerConfig_CreatesFile(t *testing.T) {
	dir := t.TempDir()

	config := &StigmerConfig{
		Name:    "test-project",
		Runtime: "go",
		Main:    "main.go",
		BaseDir: dir,
	}

	path := filepath.Join(dir, DefaultStigmerConfigFilename)
	err := WriteStigmerConfig(path, config)

	require.NoError(t, err)

	// Verify file exists
	_, err = os.Stat(path)
	assert.NoError(t, err)

	// Verify content by reading back
	loadedConfig, err := LoadStigmerConfig(dir)
	require.NoError(t, err)
	assert.Equal(t, "test-project", loadedConfig.Name)
	assert.Equal(t, "go", loadedConfig.Runtime)
	assert.Equal(t, "main.go", loadedConfig.Main)
}

func TestWriteStigmerConfig_WithOptionalFields(t *testing.T) {
	dir := t.TempDir()

	config := &StigmerConfig{
		Name:         "my-app",
		Runtime:      "go",
		Version:      "2.0.0",
		Main:         "app.go",
		Organization: "my-org",
		BaseDir:      dir,
	}

	path := filepath.Join(dir, DefaultStigmerConfigFilename)
	err := WriteStigmerConfig(path, config)
	require.NoError(t, err)

	// Verify by reading back
	loadedConfig, err := LoadStigmerConfig(dir)
	require.NoError(t, err)
	assert.Equal(t, "my-app", loadedConfig.Name)
	assert.Equal(t, "go", loadedConfig.Runtime)
	assert.Equal(t, "2.0.0", loadedConfig.Version)
	assert.Equal(t, "app.go", loadedConfig.Main)
	assert.Equal(t, "my-org", loadedConfig.Organization)
}

// =============================================================================
// Edge Cases Tests
// =============================================================================

func TestLoadStigmerConfig_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	createTestStigmerYAML(t, dir, "")

	config, err := LoadStigmerConfig(dir)

	require.Error(t, err)
	assert.Nil(t, config)
}

func TestLoadStigmerConfig_OnlyComments(t *testing.T) {
	dir := t.TempDir()
	yaml := `# This is a comment
# Another comment
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	require.Error(t, err)
	assert.Nil(t, config)
	// Should fail validation due to missing required fields
}

func TestStigmerConfig_Validate_NameWithSpaces(t *testing.T) {
	dir := t.TempDir()
	yaml := `name: "my project name"
runtime: go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	// Name with spaces should be allowed (backend may enforce stricter rules)
	require.NoError(t, err)
	assert.Equal(t, "my project name", config.Name)
}

func TestStigmerConfig_Validate_NameWithHyphens(t *testing.T) {
	dir := t.TempDir()
	yaml := `name: my-project-name
runtime: go
`
	createTestStigmerYAML(t, dir, yaml)

	config, err := LoadStigmerConfig(dir)

	require.NoError(t, err)
	assert.Equal(t, "my-project-name", config.Name)
}
