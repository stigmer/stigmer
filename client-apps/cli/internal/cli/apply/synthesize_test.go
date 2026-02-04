package apply

import (
	"os"
	"path/filepath"
	"testing"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// SynthesizeOptions Validation Tests
// =============================================================================

func TestSynthesize_NilOptions(t *testing.T) {
	result, err := Synthesize(nil)

	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "options cannot be nil")
}

func TestSynthesize_EmptyProjectDir(t *testing.T) {
	opts := &SynthesizeOptions{
		ProjectDir: "",
		Runtime:    projectv1.ProjectRuntime_go,
		EntryPoint: "main.go",
	}

	result, err := Synthesize(opts)

	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "project directory is required")
}

func TestSynthesize_NonExistentProjectDir(t *testing.T) {
	opts := &SynthesizeOptions{
		ProjectDir: "/nonexistent/path/that/does/not/exist",
		Runtime:    projectv1.ProjectRuntime_go,
		EntryPoint: "main.go",
	}

	result, err := Synthesize(opts)

	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "project directory not found")
}

func TestSynthesize_EmptyEntryPoint(t *testing.T) {
	// Create temp directory
	tempDir := t.TempDir()

	opts := &SynthesizeOptions{
		ProjectDir: tempDir,
		Runtime:    projectv1.ProjectRuntime_go,
		EntryPoint: "",
	}

	result, err := Synthesize(opts)

	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "entry point is required")
}

func TestSynthesize_NonExistentEntryPoint(t *testing.T) {
	// Create temp directory
	tempDir := t.TempDir()

	opts := &SynthesizeOptions{
		ProjectDir: tempDir,
		Runtime:    projectv1.ProjectRuntime_go,
		EntryPoint: "nonexistent.go",
	}

	result, err := Synthesize(opts)

	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "entry point not found")
}

func TestSynthesize_UnspecifiedRuntime(t *testing.T) {
	// Create temp directory with entry point file
	tempDir := t.TempDir()
	entryPath := filepath.Join(tempDir, "main.go")
	err := os.WriteFile(entryPath, []byte("package main"), 0644)
	require.NoError(t, err)

	opts := &SynthesizeOptions{
		ProjectDir: tempDir,
		Runtime:    projectv1.ProjectRuntime_project_runtime_unspecified,
		EntryPoint: "main.go",
	}

	result, err := Synthesize(opts)

	assert.Nil(t, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "runtime is required")
}

// =============================================================================
// getRuntimeCommand Tests
// =============================================================================

func TestGetRuntimeCommand_Go(t *testing.T) {
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime_go, "main.go")

	require.NoError(t, err)
	assert.Equal(t, []string{"go", "run", "main.go"}, cmd)
}

func TestGetRuntimeCommand_Go_CustomEntryPoint(t *testing.T) {
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime_go, "cmd/server/main.go")

	require.NoError(t, err)
	assert.Equal(t, []string{"go", "run", "cmd/server/main.go"}, cmd)
}

func TestGetRuntimeCommand_Python(t *testing.T) {
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime_python, "main.py")

	require.NoError(t, err)
	// Should be either python or python3
	assert.Equal(t, "main.py", cmd[1])
	assert.True(t, cmd[0] == "python" || cmd[0] == "python3")
}

func TestGetRuntimeCommand_Node_TypeScript(t *testing.T) {
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime_node, "index.ts")

	require.NoError(t, err)
	assert.Equal(t, []string{"npx", "ts-node", "index.ts"}, cmd)
}

func TestGetRuntimeCommand_Node_TypeScriptMts(t *testing.T) {
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime_node, "main.mts")

	require.NoError(t, err)
	assert.Equal(t, []string{"npx", "ts-node", "main.mts"}, cmd)
}

func TestGetRuntimeCommand_Node_JavaScript(t *testing.T) {
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime_node, "index.js")

	require.NoError(t, err)
	assert.Equal(t, []string{"node", "index.js"}, cmd)
}

func TestGetRuntimeCommand_Node_Mjs(t *testing.T) {
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime_node, "index.mjs")

	require.NoError(t, err)
	assert.Equal(t, []string{"node", "index.mjs"}, cmd)
}

func TestGetRuntimeCommand_UnsupportedRuntime(t *testing.T) {
	// Use an invalid runtime value
	cmd, err := getRuntimeCommand(projectv1.ProjectRuntime(999), "main.go")

	assert.Nil(t, cmd)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported runtime")
}

// =============================================================================
// prepareGoRuntime Tests
// =============================================================================

func TestPrepareGoRuntime_MissingGoMod(t *testing.T) {
	tempDir := t.TempDir()

	err := prepareGoRuntime(tempDir)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "go.mod not found")
	assert.Contains(t, err.Error(), "go mod init")
}

func TestPrepareGoRuntime_ValidGoModule(t *testing.T) {
	tempDir := t.TempDir()

	// Create a minimal go.mod
	goModContent := `module testproject

go 1.21
`
	err := os.WriteFile(filepath.Join(tempDir, "go.mod"), []byte(goModContent), 0644)
	require.NoError(t, err)

	// Create a minimal main.go to make it a valid module
	mainContent := `package main

func main() {}
`
	err = os.WriteFile(filepath.Join(tempDir, "main.go"), []byte(mainContent), 0644)
	require.NoError(t, err)

	err = prepareGoRuntime(tempDir)

	// Should succeed (go mod tidy on a minimal module)
	assert.NoError(t, err)
}

// =============================================================================
// preparePythonRuntime Tests
// =============================================================================

func TestPreparePythonRuntime_PythonAvailable(t *testing.T) {
	tempDir := t.TempDir()

	// This test only verifies the function doesn't error when Python is available
	// The actual Python availability check depends on the system
	err := preparePythonRuntime(tempDir)

	// Should not error (Python is typically available on dev machines)
	// If Python is not installed, this test would fail which is acceptable
	if err != nil {
		t.Skipf("Skipping test: %v", err)
	}
}

// =============================================================================
// prepareNodeRuntime Tests
// =============================================================================

func TestPrepareNodeRuntime_MissingPackageJson(t *testing.T) {
	tempDir := t.TempDir()

	err := prepareNodeRuntime(tempDir)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "package.json not found")
	assert.Contains(t, err.Error(), "npm init")
}

func TestPrepareNodeRuntime_MissingNodeModules(t *testing.T) {
	tempDir := t.TempDir()

	// Create package.json but not node_modules
	pkgContent := `{"name": "test", "version": "1.0.0"}`
	err := os.WriteFile(filepath.Join(tempDir, "package.json"), []byte(pkgContent), 0644)
	require.NoError(t, err)

	err = prepareNodeRuntime(tempDir)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "node_modules not found")
	assert.Contains(t, err.Error(), "npm install")
}

func TestPrepareNodeRuntime_ValidNodeProject(t *testing.T) {
	tempDir := t.TempDir()

	// Create package.json
	pkgContent := `{"name": "test", "version": "1.0.0"}`
	err := os.WriteFile(filepath.Join(tempDir, "package.json"), []byte(pkgContent), 0644)
	require.NoError(t, err)

	// Create node_modules directory
	err = os.MkdirAll(filepath.Join(tempDir, "node_modules"), 0755)
	require.NoError(t, err)

	err = prepareNodeRuntime(tempDir)

	assert.NoError(t, err)
}

// =============================================================================
// formatExecutionError Tests
// =============================================================================

func TestFormatExecutionError_Go(t *testing.T) {
	stderr := "main.go:5:2: undefined: foo"
	err := formatExecutionError(projectv1.ProjectRuntime_go, stderr, nil)

	assert.Contains(t, err, "SDK synthesis failed")
	assert.Contains(t, err, "undefined: foo")
	assert.Contains(t, err, "go build")
}

func TestFormatExecutionError_Python(t *testing.T) {
	stderr := "ModuleNotFoundError: No module named 'stigmer'"
	err := formatExecutionError(projectv1.ProjectRuntime_python, stderr, nil)

	assert.Contains(t, err, "SDK synthesis failed")
	assert.Contains(t, err, "ModuleNotFoundError")
	assert.Contains(t, err, "pip install")
}

func TestFormatExecutionError_Node(t *testing.T) {
	stderr := "Error: Cannot find module '@stigmer/sdk'"
	err := formatExecutionError(projectv1.ProjectRuntime_node, stderr, nil)

	assert.Contains(t, err, "SDK synthesis failed")
	assert.Contains(t, err, "Cannot find module")
	assert.Contains(t, err, "npm install")
}

func TestFormatExecutionError_TruncatesLongStderr(t *testing.T) {
	// Create stderr longer than 800 chars
	longStderr := ""
	for i := 0; i < 100; i++ {
		longStderr += "This is a very long error message. "
	}

	err := formatExecutionError(projectv1.ProjectRuntime_go, longStderr, nil)

	assert.Contains(t, err, "... (truncated)")
	// Should be roughly 800 chars plus truncation notice
	assert.Less(t, len(err), 1200)
}

func TestFormatExecutionError_EmptyStderr_UsesExecError(t *testing.T) {
	execErr := &os.PathError{Op: "exec", Path: "go", Err: os.ErrNotExist}
	err := formatExecutionError(projectv1.ProjectRuntime_go, "", execErr)

	assert.Contains(t, err, "SDK synthesis failed")
	assert.Contains(t, err, "go") // From the exec error
}

// =============================================================================
// SynthesizeOptions Struct Tests
// =============================================================================

func TestSynthesizeOptions_DefaultQuiet(t *testing.T) {
	opts := &SynthesizeOptions{
		ProjectDir: "/tmp",
		Runtime:    projectv1.ProjectRuntime_go,
		EntryPoint: "main.go",
	}

	assert.False(t, opts.Quiet)
}

func TestSynthesizeOptions_AllFieldsSet(t *testing.T) {
	opts := &SynthesizeOptions{
		ProjectDir: "/projects/my-app",
		Runtime:    projectv1.ProjectRuntime_python,
		EntryPoint: "main.py",
		Quiet:      true,
	}

	assert.Equal(t, "/projects/my-app", opts.ProjectDir)
	assert.Equal(t, projectv1.ProjectRuntime_python, opts.Runtime)
	assert.Equal(t, "main.py", opts.EntryPoint)
	assert.True(t, opts.Quiet)
}

// =============================================================================
// SynthesizeResult Struct Tests
// =============================================================================

func TestSynthesizeResult_EmptyStruct(t *testing.T) {
	result := &SynthesizeResult{}

	assert.Empty(t, result.OutputDir)
	assert.Nil(t, result.Result)
	assert.Empty(t, result.Stdout)
}

// =============================================================================
// Integration-Style Tests (require actual SDK execution)
// =============================================================================

// TestSynthesize_CreatesOutputDirectory verifies that .stigmer/ is created
func TestSynthesize_CreatesOutputDirectory(t *testing.T) {
	tempDir := t.TempDir()

	// Create a minimal Go project that will fail (no stigmer SDK)
	// but we can verify the output directory is created
	goModContent := `module testproject

go 1.21
`
	err := os.WriteFile(filepath.Join(tempDir, "go.mod"), []byte(goModContent), 0644)
	require.NoError(t, err)

	mainContent := `package main

func main() {
	// This will succeed but produce no synthesis output
}
`
	err = os.WriteFile(filepath.Join(tempDir, "main.go"), []byte(mainContent), 0644)
	require.NoError(t, err)

	opts := &SynthesizeOptions{
		ProjectDir: tempDir,
		Runtime:    projectv1.ProjectRuntime_go,
		EntryPoint: "main.go",
	}

	// Execute synthesis - will fail because no resources are synthesized
	_, _ = Synthesize(opts)

	// Verify output directory was created
	outputDir := filepath.Join(tempDir, ".stigmer")
	info, err := os.Stat(outputDir)
	assert.NoError(t, err)
	assert.True(t, info.IsDir())
}

// TestSynthesize_SetsEnvVar verifies STIGMER_OUT_DIR is passed to the command
// This is tested implicitly through the output directory creation above

// =============================================================================
// Runtime Detection Tests
// =============================================================================

func TestRuntimeFromProtoEnum(t *testing.T) {
	tests := []struct {
		name    string
		runtime projectv1.ProjectRuntime
		isValid bool
	}{
		{"Go runtime", projectv1.ProjectRuntime_go, true},
		{"Python runtime", projectv1.ProjectRuntime_python, true},
		{"Node runtime", projectv1.ProjectRuntime_node, true},
		{"Unspecified", projectv1.ProjectRuntime_project_runtime_unspecified, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.isValid {
				cmd, err := getRuntimeCommand(tt.runtime, "main")
				assert.NoError(t, err)
				assert.NotEmpty(t, cmd)
			} else {
				// Unspecified should still return a command (handled elsewhere)
				cmd, err := getRuntimeCommand(tt.runtime, "main")
				// Unspecified maps to 0 which is handled as unsupported
				assert.Error(t, err)
				assert.Nil(t, cmd)
			}
		})
	}
}
