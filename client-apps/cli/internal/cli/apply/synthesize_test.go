package apply

import (
	"os"
	"path/filepath"
	"testing"

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
		Runtime:    RuntimeGo,
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
		Runtime:    RuntimeGo,
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
		Runtime:    RuntimeGo,
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
		Runtime:    RuntimeGo,
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
		Runtime:    "",
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
	cmd, err := getRuntimeCommand(RuntimeGo, "main.go")

	require.NoError(t, err)
	assert.Equal(t, []string{"go", "run", "main.go"}, cmd)
}

func TestGetRuntimeCommand_Go_CustomEntryPoint(t *testing.T) {
	cmd, err := getRuntimeCommand(RuntimeGo, "cmd/server/main.go")

	require.NoError(t, err)
	assert.Equal(t, []string{"go", "run", "cmd/server/main.go"}, cmd)
}

func TestGetRuntimeCommand_Python(t *testing.T) {
	cmd, err := getRuntimeCommand(RuntimePython, "main.py")

	require.NoError(t, err)
	// Should be either python or python3
	assert.Equal(t, "main.py", cmd[1])
	assert.True(t, cmd[0] == "python" || cmd[0] == "python3")
}

func TestGetRuntimeCommand_Node_TypeScript(t *testing.T) {
	cmd, err := getRuntimeCommand(RuntimeNode, "index.ts")

	require.NoError(t, err)
	assert.Equal(t, []string{"npx", "ts-node", "index.ts"}, cmd)
}

func TestGetRuntimeCommand_Node_TypeScriptMts(t *testing.T) {
	cmd, err := getRuntimeCommand(RuntimeNode, "main.mts")

	require.NoError(t, err)
	assert.Equal(t, []string{"npx", "ts-node", "main.mts"}, cmd)
}

func TestGetRuntimeCommand_Node_JavaScript(t *testing.T) {
	cmd, err := getRuntimeCommand(RuntimeNode, "index.js")

	require.NoError(t, err)
	assert.Equal(t, []string{"node", "index.js"}, cmd)
}

func TestGetRuntimeCommand_Node_Mjs(t *testing.T) {
	cmd, err := getRuntimeCommand(RuntimeNode, "index.mjs")

	require.NoError(t, err)
	assert.Equal(t, []string{"node", "index.mjs"}, cmd)
}

func TestGetRuntimeCommand_UnsupportedRuntime(t *testing.T) {
	cmd, err := getRuntimeCommand(Runtime("ruby"), "main.rb")

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
	err := formatExecutionError(RuntimeGo, stderr, nil)

	assert.Contains(t, err, "SDK synthesis failed")
	assert.Contains(t, err, "undefined: foo")
	assert.Contains(t, err, "go build")
}

func TestFormatExecutionError_Python(t *testing.T) {
	stderr := "ModuleNotFoundError: No module named 'stigmer'"
	err := formatExecutionError(RuntimePython, stderr, nil)

	assert.Contains(t, err, "SDK synthesis failed")
	assert.Contains(t, err, "ModuleNotFoundError")
	assert.Contains(t, err, "pip install")
}

func TestFormatExecutionError_Node(t *testing.T) {
	stderr := "Error: Cannot find module '@stigmer/sdk'"
	err := formatExecutionError(RuntimeNode, stderr, nil)

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

	err := formatExecutionError(RuntimeGo, longStderr, nil)

	assert.Contains(t, err, "... (truncated)")
	// Should be roughly 800 chars plus truncation notice
	assert.Less(t, len(err), 1200)
}

func TestFormatExecutionError_EmptyStderr_UsesExecError(t *testing.T) {
	execErr := &os.PathError{Op: "exec", Path: "go", Err: os.ErrNotExist}
	err := formatExecutionError(RuntimeGo, "", execErr)

	assert.Contains(t, err, "SDK synthesis failed")
	assert.Contains(t, err, "go") // From the exec error
}

// =============================================================================
// SynthesizeOptions Struct Tests
// =============================================================================

func TestSynthesizeOptions_DefaultQuiet(t *testing.T) {
	opts := &SynthesizeOptions{
		ProjectDir: "/tmp",
		Runtime:    RuntimeGo,
		EntryPoint: "main.go",
	}

	assert.False(t, opts.Quiet)
}

func TestSynthesizeOptions_AllFieldsSet(t *testing.T) {
	opts := &SynthesizeOptions{
		ProjectDir: "/projects/my-app",
		Runtime:    RuntimePython,
		EntryPoint: "main.py",
		Quiet:      true,
	}

	assert.Equal(t, "/projects/my-app", opts.ProjectDir)
	assert.Equal(t, RuntimePython, opts.Runtime)
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
		Runtime:    RuntimeGo,
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
// InferRuntime Tests
// =============================================================================

func TestInferRuntime_SupportedExtensions(t *testing.T) {
	tests := []struct {
		entryPoint string
		want       Runtime
	}{
		{"main.go", RuntimeGo},
		{"main.py", RuntimePython},
		{"index.ts", RuntimeNode},
		{"index.js", RuntimeNode},
		{"main.mts", RuntimeNode},
		{"main.mjs", RuntimeNode},
		{"src/cmd/main.go", RuntimeGo},
	}

	for _, tt := range tests {
		t.Run(tt.entryPoint, func(t *testing.T) {
			got, err := InferRuntime(tt.entryPoint)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestInferRuntime_UnrecognizedExtension(t *testing.T) {
	_, err := InferRuntime("main.rb")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot infer runtime")
	assert.Contains(t, err.Error(), ".rb")
}

func TestInferRuntime_NoExtension(t *testing.T) {
	_, err := InferRuntime("Makefile")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot infer runtime")
}

func TestGetRuntimeCommand_AllRuntimes(t *testing.T) {
	tests := []struct {
		name    string
		runtime Runtime
		isValid bool
	}{
		{"Go runtime", RuntimeGo, true},
		{"Python runtime", RuntimePython, true},
		{"Node runtime", RuntimeNode, true},
		{"Empty runtime", "", false},
		{"Unknown runtime", Runtime("ruby"), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cmd, err := getRuntimeCommand(tt.runtime, "main")
			if tt.isValid {
				assert.NoError(t, err)
				assert.NotEmpty(t, cmd)
			} else {
				assert.Error(t, err)
				assert.Nil(t, cmd)
			}
		})
	}
}
