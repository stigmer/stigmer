package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
)

// Validation Philosophy (Pulumi-Inspired)
//
// Unlike traditional tools that pre-validate everything, Stigmer follows Pulumi's approach:
// 1. Trust the language tooling (Go compiler validates imports, syntax, etc.)
// 2. Execute the program and let natural failures occur
// 3. Validate outcomes (did resources get registered?)
//
// This means:
// ✅ No string-based import checking (brittle, breaks on path changes)
// ✅ No AST parsing to validate code structure
// ✅ Let `go run` fail naturally if imports are missing
// ✅ Check if manifests were generated after execution
//
// Benefits:
// - Simpler code
// - Better error messages from Go compiler
// - More flexible (works with any import path structure)
// - Less maintenance burden

// ValidateGoModule checks if go.mod exists and is valid.
// If go.mod doesn't exist, we let `go run .` handle module initialization.
func ValidateGoModule(projectDir string) error {
	goModPath := filepath.Join(projectDir, "go.mod")

	// Check if go.mod exists
	if _, err := os.Stat(goModPath); err != nil {
		if os.IsNotExist(err) {
			// go.mod doesn't exist - let Go's tooling handle it
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
