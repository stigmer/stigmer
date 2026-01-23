package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
)

// ExecuteGoAndGetSynthesis runs a Go file that uses stigmer.Run() for synthesis.
//
// Pulumi-Inspired Execution Model:
// Users write declarative code that registers resources (agents, skills, workflows).
// The CLI executes the program and collects the generated resource files.
//
// Example user code:
//
//	package main
//	import "github.com/stigmer/stigmer/sdk/go/stigmer"
//	import "github.com/stigmer/stigmer/sdk/go/agent"
//	import "github.com/stigmer/stigmer/sdk/go/skill"
//	
//	func main() {
//	    stigmer.Run(func(ctx *stigmer.Context) error {
//	        skill.New(
//	            skill.WithName("code-analysis"),
//	            skill.WithMarkdown("# Code analysis guide..."),
//	        )
//	        
//	        agent.New(ctx,
//	            agent.WithName("code-reviewer"),
//	            agent.WithInstructions("Review code"),
//	        )
//	        return nil
//	    })
//	}
//
// Execution flow:
// 1. Run user's code with `go run .` (Go compiler validates everything)
// 2. Set STIGMER_OUT_DIR environment variable
// 3. stigmer.Run() calls ctx.Synthesize() which writes individual .pb files
// 4. Read generated files (skill-0.pb, agent-0.pb, dependencies.json, etc.)
// 5. Validate that resources were created
//
// This approach:
// ✅ Trusts Go's tooling (no custom validation needed)
// ✅ Provides clear error messages from Go compiler
// ✅ Validates outcomes (resources created) not syntax (imports)
func ExecuteGoAndGetSynthesis(goFile string) (*synthesis.Result, error) {
	// Validate file exists
	absPath, err := filepath.Abs(goFile)
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve file path")
	}

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil, errors.Errorf("file not found: %s", goFile)
	}

	// Check file extension
	if filepath.Ext(goFile) != ".go" {
		return nil, errors.Errorf("file must be a Go file (.go): %s", goFile)
	}

	// Get the project directory (directory containing the Go file)
	projectDir := filepath.Dir(absPath)

	// Validate go.mod if it exists
	if err := ValidateGoModule(projectDir); err != nil {
		return nil, errors.Wrap(err, "invalid Go module")
	}

	// Run go mod tidy to ensure dependencies are up to date
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = projectDir
	tidyCmd.Env = os.Environ()
	if tidyOutput, tidyErr := tidyCmd.CombinedOutput(); tidyErr != nil {
		return nil, errors.Errorf("failed to update dependencies:\n%s", string(tidyOutput))
	}

	// Create output directory for manifest files
	outputDir := filepath.Join(projectDir, ".stigmer")
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, errors.Wrap(err, "failed to create output directory")
	}

	// Execute the user's code directly with STIGMER_OUT_DIR set
	// stigmer.Run() will handle synthesis automatically
	// Use the specific file instead of "." to support //go:build ignore files
	cmd := exec.Command("go", "run", filepath.Base(goFile))
	cmd.Dir = projectDir
	cmd.Env = append(os.Environ(), "STIGMER_OUT_DIR="+outputDir)

	// Capture both stdout and stderr
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errorMsg := stderr.String()
		if len(errorMsg) > 500 {
			errorMsg = errorMsg[:500] + "..."
		}
		if errorMsg == "" {
			errorMsg = err.Error()
		}
		return nil, errors.Errorf("failed to execute Go agent:\n%s", errorMsg)
	}

	// Print stdout for debugging (including debug prints from SDK)
	if stdoutStr := stdout.String(); stdoutStr != "" {
		fmt.Println(stdoutStr)
	}

	// Read all synthesized resources from output directory
	result, err := synthesis.ReadFromDirectory(outputDir)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read synthesis output")
	}

	return result, nil
}
