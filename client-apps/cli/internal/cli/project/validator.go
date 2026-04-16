// Package project provides CLI utilities for managing Project resources.
package project

import (
	"fmt"
	"path/filepath"
	"strings"

	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
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

// supportedEntryPointExtensions lists the file extensions recognized by the SDK track.
// The CLI infers the runtime from the extension:
//
//	.go        → Go SDK    (go run <entry_point>)
//	.py        → Python SDK (python <entry_point>)
//	.ts, .mts  → Node SDK   (npx ts-node <entry_point>)
//	.js, .mjs  → Node SDK   (node <entry_point>)
var supportedEntryPointExtensions = []string{".go", ".py", ".ts", ".js", ".mts", ".mjs"}

// Validate performs cross-field business logic validation on a Project.
//
// Schema validation (apiVersion, kind, metadata, spec) is handled by
// protovalidate in Load(). This function validates relationships between
// fields that cannot be expressed in proto validation rules:
//
//   - Entry point extension must be a recognized SDK language
//   - Project name must not be a reserved name
//   - Entry point must be a safe relative path
//
// Returns nil if the project passes all cross-field validations.
func Validate(project *projectv1.Project) error {
	if project == nil || project.Spec == nil {
		return nil // Schema validation handles required fields
	}

	if err := validateEntryPointExtension(project); err != nil {
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

// validateEntryPointExtension ensures entry_point (when set) has a recognized
// SDK file extension. Empty entry_point is valid — it indicates declarative mode.
func validateEntryPointExtension(project *projectv1.Project) error {
	entryPoint := project.Spec.GetEntryPoint()
	if entryPoint == "" {
		return nil
	}

	ext := strings.ToLower(filepath.Ext(entryPoint))
	for _, supported := range supportedEntryPointExtensions {
		if ext == supported {
			return nil
		}
	}

	return fmt.Errorf(
		"entry point %q has unrecognized extension %q\n\n"+
			"Supported extensions: %s\n"+
			"The CLI infers the SDK runtime from the file extension.",
		entryPoint, ext, strings.Join(supportedEntryPointExtensions, ", "),
	)
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

	if filepath.IsAbs(entryPoint) {
		return fmt.Errorf(
			"entry point %q must be a relative path\n\n"+
				"Use a relative path like \"main.go\" or \"src/main.py\" instead of an absolute path.",
			entryPoint,
		)
	}

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
	parts := strings.Split(filepath.ToSlash(path), "/")
	for _, part := range parts {
		if part == ".." {
			return true
		}
	}
	return false
}
