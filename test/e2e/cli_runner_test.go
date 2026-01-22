package e2e

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer"
)

// RunCLI executes CLI commands in-process without spawning a subprocess
// This is faster than exec.Command and allows for better debugging
//
// Note: This currently uses subprocess execution instead of in-process
// because the CLI root command has global state that doesn't reset properly
// between test invocations. This is a known limitation and will be improved
// in future iterations.
//
// Args:
//   - args: CLI arguments (e.g., "apply", "--config", "testdata/basic_agent.go")
//
// Returns:
//   - output: Combined stdout/stderr output
//   - err: Error if command failed
//
// Example:
//   output, err := RunCLI("apply", "--config", "testdata/basic_agent.go")
func RunCLI(args ...string) (string, error) {
	// TODO: Implement true in-process execution
	// Currently blocked by cobra command state not resetting between calls
	// For now, we'll document this limitation and use it for simpler commands
	
	// For apply command specifically, we need subprocess execution
	// because the Go SDK execution environment needs isolation
	return RunCLISubprocess(args...)
}

// RunCLIInProcess executes CLI commands truly in-process (experimental)
// Currently has limitations with command state management
func RunCLIInProcess(args ...string) (string, error) {
	var stdout, stderr bytes.Buffer

	// Get root command (exposed for testing)
	rootCmd := stigmer.GetRootCommand()

	// Configure output capture
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(args)

	// Execute command
	err := rootCmd.Execute()

	// Combine output
	output := stdout.String()
	if stderr.Len() > 0 {
		output += "\n--- STDERR ---\n" + stderr.String()
	}

	if err != nil {
		return output, fmt.Errorf("CLI command failed: %w\nOutput: %s", err, output)
	}

	return output, nil
}

// RunCLISubprocess executes CLI commands as a subprocess
// This provides full isolation and is the current recommended approach
func RunCLISubprocess(args ...string) (string, error) {
	// Find the stigmer binary
	// We're in test/e2e, CLI main is at ../../client-apps/cli/cmd/stigmer/main.go
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}

	cliMainPath := filepath.Join(cwd, "..", "..", "client-apps", "cli", "main.go")

	// Use 'go run' to execute the CLI
	cmdArgs := append([]string{"run", cliMainPath}, args...)
	cmd := exec.Command("go", cmdArgs...)

	// Capture output
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Run command
	err = cmd.Run()

	// Combine output
	output := stdout.String()
	if stderr.Len() > 0 {
		output += "\n--- STDERR ---\n" + stderr.String()
	}

	if err != nil {
		return output, fmt.Errorf("CLI subprocess failed: %w\nOutput: %s", err, output)
	}

	return output, nil
}

// RunCLIWithServerAddr is a convenience wrapper that adds the --server flag
func RunCLIWithServerAddr(serverPort int, args ...string) (string, error) {
	fullArgs := append(args, "--server", fmt.Sprintf("localhost:%d", serverPort))
	return RunCLI(fullArgs...)
}
