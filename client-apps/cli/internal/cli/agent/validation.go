package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
)

// ValidateGoModule checks if go.mod exists and is valid.
// If go.mod doesn't exist, we'll let `go run .` handle the module initialization.
func ValidateGoModule(projectDir string) error {
	goModPath := filepath.Join(projectDir, "go.mod")

	// Check if go.mod exists
	if _, err := os.Stat(goModPath); err != nil {
		if os.IsNotExist(err) {
			// go.mod doesn't exist - this is actually fine, go run will handle it
			return nil
		}
		return errors.Wrap(err, "failed to check go.mod")
	}

	// go.mod exists - validate it's readable
	data, err := os.ReadFile(goModPath)
	if err != nil {
		return errors.Wrap(err, "failed to read go.mod")
	}

	// Basic validation - should contain "module" directive
	content := string(data)
	if !strings.Contains(content, "module ") {
		return fmt.Errorf("go.mod is invalid: missing module directive")
	}

	return nil
}

// ValidateGoFile checks if a Go file is valid for agent deployment.
// With the Copy & Patch architecture, users only need to import the agent package.
func ValidateGoFile(goFile string) error {
	// Check file exists
	if _, err := os.Stat(goFile); os.IsNotExist(err) {
		return errors.Errorf("file not found: %s", goFile)
	}

	// Check file extension
	if filepath.Ext(goFile) != ".go" {
		return errors.Errorf("file must be a Go file (.go): %s", goFile)
	}

	// Check if file contains SDK imports (basic validation)
	content, err := os.ReadFile(goFile)
	if err != nil {
		return errors.Wrap(err, "failed to read file")
	}

	contentStr := string(content)
	hasAgentImport := strings.Contains(contentStr, "github.com/stigmer/stigmer-sdk/go/agent")
	hasWorkflowImport := strings.Contains(contentStr, "github.com/stigmer/stigmer-sdk/go/workflow")
	hasStigmerImport := strings.Contains(contentStr, "github.com/stigmer/stigmer-sdk/go/stigmer")
	
	if !hasAgentImport && !hasWorkflowImport && !hasStigmerImport {
		return errors.New("file must import Stigmer SDK (agent, workflow, or stigmer package)")
	}

	return nil
}
