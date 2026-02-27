// Package apply provides SDK synthesis execution for the stigmer apply command.
//
// The synthesizer executes user SDK programs (Go, Python, Node) and collects
// the generated resource manifests for deployment to the backend.
//
// SDK Execution Model:
// Users write declarative code using the Stigmer SDK that registers resources
// (agents, skills, workflows). The CLI executes the program with STIGMER_OUT_DIR
// set, and the SDK writes individual .pb files for each resource.
//
// Supported Runtimes:
//   - Go: `go run <entry_point>`
//   - Python: `python <entry_point>`
//   - Node: `npx ts-node <entry_point>` for .ts, `node <entry_point>` for .js
package apply

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
)

// SynthesizeOptions configures the SDK synthesis execution.
type SynthesizeOptions struct {
	// ProjectDir is the directory containing the SDK code and stigmer.yaml.
	ProjectDir string

	// Runtime specifies which language runtime to use (go, python, node).
	Runtime Runtime

	// EntryPoint is the SDK entry point file (e.g., main.go, main.py, index.ts).
	EntryPoint string

	// Quiet suppresses SDK stdout output during synthesis.
	Quiet bool
}

// SynthesizeResult contains the outcome of SDK synthesis.
type SynthesizeResult struct {
	// OutputDir is the directory containing synthesized .pb files.
	OutputDir string

	// Result contains parsed resource manifests from synthesis output.
	Result *synthesis.Result

	// Stdout contains SDK program stdout (useful for debugging).
	Stdout string
}

// Synthesize executes the SDK entry point and captures synthesized manifests.
//
// The function:
// 1. Validates inputs (project dir exists, entry point exists)
// 2. Creates .stigmer/ output directory
// 3. Runs runtime-specific preparation (e.g., go mod tidy)
// 4. Executes SDK with STIGMER_OUT_DIR environment variable
// 5. Parses synthesized .pb files using synthesis.ReadFromDirectory()
//
// Returns a SynthesizeResult containing parsed manifests, or an error with
// actionable guidance for common issues (missing dependencies, compile errors).
func Synthesize(opts *SynthesizeOptions) (*SynthesizeResult, error) {
	if opts == nil {
		return nil, errors.New("synthesize options cannot be nil")
	}

	// Validate project directory exists
	if opts.ProjectDir == "" {
		return nil, errors.New("project directory is required")
	}

	absProjectDir, err := filepath.Abs(opts.ProjectDir)
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve project directory")
	}

	if _, err := os.Stat(absProjectDir); os.IsNotExist(err) {
		return nil, errors.Errorf("project directory not found: %s", opts.ProjectDir)
	}

	// Validate entry point exists
	if opts.EntryPoint == "" {
		return nil, errors.New("entry point is required")
	}

	entryPointPath := filepath.Join(absProjectDir, opts.EntryPoint)
	if _, err := os.Stat(entryPointPath); os.IsNotExist(err) {
		return nil, errors.Errorf("entry point not found: %s", opts.EntryPoint)
	}

	// Validate runtime
	if opts.Runtime == "" {
		return nil, errors.New("runtime is required (go, python, or node)")
	}

	// Create output directory
	outputDir := filepath.Join(absProjectDir, ".stigmer")
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, errors.Wrap(err, "failed to create output directory")
	}

	// Run runtime-specific preparation
	if err := prepareRuntime(opts.Runtime, absProjectDir); err != nil {
		return nil, err
	}

	// Build and execute the SDK command
	cmdArgs, err := getRuntimeCommand(opts.Runtime, opts.EntryPoint)
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
	cmd.Dir = absProjectDir
	cmd.Env = append(os.Environ(), "STIGMER_OUT_DIR="+outputDir)

	// Capture stdout and stderr
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := formatExecutionError(opts.Runtime, stderr.String(), err)
		return nil, errors.New(errMsg)
	}

	// Parse synthesized manifests
	result, err := synthesis.ReadFromDirectory(outputDir)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read synthesis output")
	}

	return &SynthesizeResult{
		OutputDir: outputDir,
		Result:    result,
		Stdout:    stdout.String(),
	}, nil
}

// getRuntimeCommand returns the command arguments for executing the SDK entry point.
func getRuntimeCommand(runtime Runtime, entryPoint string) ([]string, error) {
	switch runtime {
	case RuntimeGo:
		return []string{"go", "run", entryPoint}, nil

	case RuntimePython:
		if _, err := exec.LookPath("python3"); err == nil {
			return []string{"python3", entryPoint}, nil
		}
		return []string{"python", entryPoint}, nil

	case RuntimeNode:
		ext := filepath.Ext(entryPoint)
		if ext == ".ts" || ext == ".tsx" || ext == ".mts" {
			return []string{"npx", "ts-node", entryPoint}, nil
		}
		return []string{"node", entryPoint}, nil

	default:
		return nil, errors.Errorf("unsupported runtime: %v", runtime)
	}
}

// prepareRuntime runs runtime-specific preparation steps before SDK execution.
func prepareRuntime(runtime Runtime, projectDir string) error {
	switch runtime {
	case RuntimeGo:
		return prepareGoRuntime(projectDir)
	case RuntimePython:
		return preparePythonRuntime(projectDir)
	case RuntimeNode:
		return prepareNodeRuntime(projectDir)
	default:
		return nil
	}
}

// prepareGoRuntime ensures Go dependencies are up to date.
func prepareGoRuntime(projectDir string) error {
	// Check if go.mod exists
	goModPath := filepath.Join(projectDir, "go.mod")
	if _, err := os.Stat(goModPath); os.IsNotExist(err) {
		return errors.New("go.mod not found: run 'go mod init' to initialize a Go module")
	}

	// Run go mod tidy to ensure dependencies are current
	cmd := exec.Command("go", "mod", "tidy")
	cmd.Dir = projectDir
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if err != nil {
		return errors.Errorf("failed to update Go dependencies:\n%s\n\nRun 'go mod tidy' manually to resolve", string(output))
	}

	return nil
}

// preparePythonRuntime validates Python environment is ready.
func preparePythonRuntime(projectDir string) error {
	// Check if python/python3 is available
	pythonCmd := "python"
	if _, err := exec.LookPath("python3"); err == nil {
		pythonCmd = "python3"
	} else if _, err := exec.LookPath("python"); err != nil {
		return errors.New("Python not found: install Python 3.x and ensure it's in your PATH")
	}

	// Verify Python version is 3.x
	cmd := exec.Command(pythonCmd, "--version")
	output, err := cmd.Output()
	if err == nil && !strings.Contains(string(output), "Python 3") {
		return errors.New("Python 3.x required: your system has Python 2.x")
	}

	// Check for requirements.txt and suggest install if present
	reqPath := filepath.Join(projectDir, "requirements.txt")
	if _, err := os.Stat(reqPath); err == nil {
		// requirements.txt exists - user should install deps
		// We don't auto-install to avoid modifying user's environment
		// The error will be caught during execution if deps are missing
	}

	return nil
}

// prepareNodeRuntime validates Node.js environment is ready.
func prepareNodeRuntime(projectDir string) error {
	// Check if node is available
	if _, err := exec.LookPath("node"); err != nil {
		return errors.New("Node.js not found: install Node.js and ensure it's in your PATH")
	}

	// Check for package.json
	pkgPath := filepath.Join(projectDir, "package.json")
	if _, err := os.Stat(pkgPath); os.IsNotExist(err) {
		return errors.New("package.json not found: run 'npm init' to initialize a Node.js project")
	}

	// Check if node_modules exists (deps installed)
	modulesPath := filepath.Join(projectDir, "node_modules")
	if _, err := os.Stat(modulesPath); os.IsNotExist(err) {
		return errors.New("node_modules not found: run 'npm install' to install dependencies")
	}

	return nil
}

// formatExecutionError creates a helpful error message based on runtime and error output.
func formatExecutionError(runtime Runtime, stderr string, execErr error) string {
	if len(stderr) > 800 {
		stderr = stderr[:800] + "\n... (truncated)"
	}

	var guidance string
	switch runtime {
	case RuntimeGo:
		guidance = "Check for compile errors above. Run 'go build' to see full error output."
	case RuntimePython:
		guidance = "If you see import errors, run 'pip install -r requirements.txt' in a virtual environment."
	case RuntimeNode:
		guidance = "If you see module errors, run 'npm install' to install dependencies."
	}

	if stderr == "" {
		stderr = execErr.Error()
	}

	return "SDK synthesis failed:\n" + stderr + "\n\n" + guidance
}
