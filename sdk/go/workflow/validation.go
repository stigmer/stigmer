package workflow

import (
	"fmt"
	"regexp"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Validation constants for SDK-specific rules.
const (
	// Task name validation
	taskNameMaxLength = 100

	// Document validation (from document.go)
	dslVersion           = "1.0.0"
	namespaceMinLength   = 1
	namespaceMaxLength   = 100
	nameMinLength        = 1
	nameMaxLength        = 100
	descriptionMaxLength = 500
)

// taskNameRegex matches valid task names (alphanumeric with hyphens and underscores).
// This is an SDK-specific naming convention.
var taskNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// semverRegex matches valid semver strings (simplified).
var semverRegex = regexp.MustCompile(`^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$`)

// validate validates SDK-specific rules for a Workflow.
//
// This function validates:
//   - Args.Document fields (namespace, name, version format)
//   - Task name format and uniqueness (when tasks exist)
//
// Note: Proto-level validations are handled by protovalidate in ToProto().
func validate(w *Workflow) error {
	// Validate Args exists
	if w.Args == nil {
		return validation.NewValidationErrorWithCause(
			"args",
			"",
			"required",
			"workflow args is required",
			ErrMissingRequiredField,
		)
	}

	// Validate Args.Document
	if err := validateArgsDocument(w); err != nil {
		return err
	}

	// Note: We allow empty workflows during creation to support the Pulumi-style
	// pattern where workflows are created first, then tasks are added via
	// wf.HttpGet(), wf.SetVars(), etc. Task name validation happens at AddTask time.
	// Proto-level task validation happens in ToProto() via protovalidate.

	return nil
}

// validateArgsDocument validates Args.Document fields.
func validateArgsDocument(w *Workflow) error {
	doc := w.Args.Document
	if doc == nil {
		return validation.NewValidationErrorWithCause(
			"args.document",
			"",
			"required",
			"workflow document is required",
			ErrMissingRequiredField,
		)
	}

	// Validate DSL version
	if doc.Dsl != dslVersion {
		return validation.NewValidationErrorWithCause(
			"args.document.dsl",
			doc.Dsl,
			"const",
			fmt.Sprintf("DSL version must be %q", dslVersion),
			ErrInvalidVersion,
		)
	}

	// Validate namespace (required)
	if doc.Namespace == "" {
		return validation.NewValidationErrorWithCause(
			"args.document.namespace",
			doc.Namespace,
			"required",
			"namespace is required",
			ErrInvalidNamespace,
		)
	}
	if len(doc.Namespace) < namespaceMinLength || len(doc.Namespace) > namespaceMaxLength {
		return validation.NewValidationErrorWithCause(
			"args.document.namespace",
			doc.Namespace,
			"length",
			fmt.Sprintf("namespace must be between %d and %d characters", namespaceMinLength, namespaceMaxLength),
			ErrInvalidNamespace,
		)
	}

	// Validate name (required)
	if doc.Name == "" {
		return validation.NewValidationErrorWithCause(
			"args.document.name",
			doc.Name,
			"required",
			"name is required",
			ErrInvalidName,
		)
	}
	if len(doc.Name) < nameMinLength || len(doc.Name) > nameMaxLength {
		return validation.NewValidationErrorWithCause(
			"args.document.name",
			doc.Name,
			"length",
			fmt.Sprintf("name must be between %d and %d characters", nameMinLength, nameMaxLength),
			ErrInvalidName,
		)
	}

	// Validate version (if provided, must be semver)
	if doc.Version != "" && !semverRegex.MatchString(doc.Version) {
		return validation.NewValidationErrorWithCause(
			"args.document.version",
			doc.Version,
			"semver",
			"version must be valid semver (e.g., 1.0.0)",
			ErrInvalidVersion,
		)
	}

	// Validate description (optional)
	if len(w.Args.Description) > descriptionMaxLength {
		return validation.NewValidationErrorWithCause(
			"args.description",
			w.Args.Description,
			"max_length",
			fmt.Sprintf("description must be at most %d characters", descriptionMaxLength),
			ErrInvalidDescription,
		)
	}

	return nil
}

// validateTaskName validates a task name against SDK naming conventions.
//
// Rules (SDK-specific, not in proto):
//   - Required (non-empty)
//   - Max 100 characters
//   - Alphanumeric with hyphens and underscores
//
// Note: The proto has a required rule for task.name, but the format regex
// is an SDK-specific convention for consistent naming.
func validateTaskName(name string) error {
	if name == "" {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"required",
			"task name is required",
			ErrInvalidTaskName,
		)
	}

	if len(name) > taskNameMaxLength {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"max_length",
			fmt.Sprintf("task name must be at most %d characters", taskNameMaxLength),
			ErrInvalidTaskName,
		)
	}

	if !taskNameRegex.MatchString(name) {
		return validation.NewValidationErrorWithCause(
			"name",
			name,
			"format",
			"task name must be alphanumeric with hyphens and underscores",
			ErrInvalidTaskName,
		)
	}

	return nil
}
