// Package project provides CLI utilities for managing Project resources.
package project

import (
	"fmt"
	"path/filepath"
	"strings"

	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
)

// reservedNames contains project names reserved for platform use.
var reservedNames = []string{
	"default", // default namespace
	"system",  // system components
	"admin",   // administrative namespace
	"root",    // root namespace
	"stigmer", // platform namespace
	"test",    // reserved for testing
}

// Validate performs cross-field business logic validation on a Project.
//
// Schema validation (apiVersion, kind, metadata, spec, runtime) is handled
// by protovalidate in Load(). This function validates relationships between
// fields that cannot be expressed in proto validation rules:
//
//   - Runtime and entry_point extension must be consistent
//   - Project name must not be a reserved name
//   - Entry point must be a safe relative path
//
// Returns nil if the project passes all cross-field validations.
func Validate(project *projectv1.Project) error {
	if project == nil || project.Spec == nil {
		return nil // Schema validation handles required fields
	}

	if err := validateRuntimeEntryPoint(project); err != nil {
		return err
	}

	if err := validateReservedNames(project); err != nil {
		return err
	}

	if err := validateEntryPointPath(project); err != nil {
		return err
	}

	return nil
}

// validateRuntimeEntryPoint ensures the entry_point extension matches the runtime.
// Empty entry_point is valid - defaults are applied at apply-time.
func validateRuntimeEntryPoint(project *projectv1.Project) error {
	entryPoint := project.Spec.GetEntryPoint()
	if entryPoint == "" {
		return nil // Empty is valid, defaults applied at apply-time
	}

	runtime := project.Spec.GetRuntime()
	validExts := getValidExtensions(runtime)

	ext := strings.ToLower(filepath.Ext(entryPoint))
	for _, validExt := range validExts {
		if ext == validExt {
			return nil
		}
	}

	runtimeName := strings.ToLower(runtime.String())
	return fmt.Errorf(
		"entry point %q has invalid extension for %s runtime\n\n"+
			"Expected extensions: %s\n"+
			"Either change the entry_point or the runtime setting.",
		entryPoint, runtimeName, strings.Join(validExts, ", "),
	)
}

// getValidExtensions returns the valid file extensions for a given runtime.
func getValidExtensions(runtime projectv1.ProjectRuntime) []string {
	switch runtime {
	case projectv1.ProjectRuntime_go:
		return []string{".go"}
	case projectv1.ProjectRuntime_python:
		return []string{".py"}
	case projectv1.ProjectRuntime_node:
		return []string{".js", ".ts", ".mjs", ".mts"}
	default:
		return nil
	}
}

// validateReservedNames ensures the project name is not a reserved name.
func validateReservedNames(project *projectv1.Project) error {
	if project.Metadata == nil {
		return nil // Schema validation handles required metadata
	}

	name := project.Metadata.GetName()
	if name == "" {
		return nil // Schema validation handles required name
	}

	if isReservedName(name) {
		return fmt.Errorf(
			"project name %q is reserved for platform use\n\n"+
				"Choose a different name. Reserved names: %s",
			name, strings.Join(reservedNames, ", "),
		)
	}

	return nil
}

// isReservedName checks if the given name is in the reserved names list.
func isReservedName(name string) bool {
	lowerName := strings.ToLower(name)
	for _, reserved := range reservedNames {
		if lowerName == reserved {
			return true
		}
	}
	return false
}

// validateEntryPointPath ensures the entry_point is a safe relative path.
// Rejects absolute paths and directory traversal attempts.
func validateEntryPointPath(project *projectv1.Project) error {
	entryPoint := project.Spec.GetEntryPoint()
	if entryPoint == "" {
		return nil // Empty is valid
	}

	// Check for absolute path
	if filepath.IsAbs(entryPoint) {
		return fmt.Errorf(
			"entry point %q must be a relative path\n\n"+
				"Use a relative path like \"main.go\" or \"src/main.py\" instead of an absolute path.",
			entryPoint,
		)
	}

	// Check for directory traversal
	if containsDirectoryTraversal(entryPoint) {
		return fmt.Errorf(
			"entry point %q contains directory traversal (..)\n\n"+
				"Use a relative path without \"..\" components for security reasons.",
			entryPoint,
		)
	}

	return nil
}

// containsDirectoryTraversal checks if the path contains ".." components.
func containsDirectoryTraversal(path string) bool {
	// Clean the path and check for ".." in components
	parts := strings.Split(filepath.ToSlash(path), "/")
	for _, part := range parts {
		if part == ".." {
			return true
		}
	}
	return false
}
