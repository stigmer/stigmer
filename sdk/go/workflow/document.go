package workflow

import "regexp"

// Document represents workflow metadata.
// Maps to the `document:` block in Zigflow DSL YAML.
type Document struct {
	// DSL version (semver). Must be "1.0.0" for current Zigflow.
	DSL string

	// Workflow namespace (organization/categorization).
	Namespace string

	// Workflow name (unique identifier within namespace).
	Name string

	// Workflow version (semver).
	Version string

	// Human-readable description.
	Description string
}

// Validation constants for Document.
const (
	dslVersion          = "1.0.0" // Current supported DSL version
	namespaceMinLength  = 1
	namespaceMaxLength  = 100
	nameMinLength       = 1
	nameMaxLength       = 100
	versionMinLength    = 1
	descriptionMaxLength = 500
)

// Regex for semver validation (simplified).
var semverRegex = regexp.MustCompile(`^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$`)

// validateDocument validates a workflow document.
func validateDocument(d *Document) error {
	// Validate DSL version
	if d.DSL != dslVersion {
		return NewValidationErrorWithCause(
			"document.dsl",
			d.DSL,
			"const",
			`DSL version must be "1.0.0"`,
			ErrInvalidVersion,
		)
	}

	// Validate namespace (required)
	if d.Namespace == "" {
		return NewValidationErrorWithCause(
			"document.namespace",
			d.Namespace,
			"required",
			"namespace is required",
			ErrInvalidNamespace,
		)
	}
	if len(d.Namespace) < namespaceMinLength || len(d.Namespace) > namespaceMaxLength {
		return NewValidationErrorWithCause(
			"document.namespace",
			d.Namespace,
			"length",
			"namespace must be between 1 and 100 characters",
			ErrInvalidNamespace,
		)
	}

	// Validate name (required)
	if d.Name == "" {
		return NewValidationErrorWithCause(
			"document.name",
			d.Name,
			"required",
			"name is required",
			ErrInvalidName,
		)
	}
	if len(d.Name) < nameMinLength || len(d.Name) > nameMaxLength {
		return NewValidationErrorWithCause(
			"document.name",
			d.Name,
			"length",
			"name must be between 1 and 100 characters",
			ErrInvalidName,
		)
	}

	// Validate version (if provided, must be semver)
	// Note: Version is set to "0.1.0" by default in New() if not provided
	if d.Version != "" && !semverRegex.MatchString(d.Version) {
		return NewValidationErrorWithCause(
			"document.version",
			d.Version,
			"semver",
			"version must be valid semver (e.g., 1.0.0)",
			ErrInvalidVersion,
		)
	}

	// Validate description (optional)
	if len(d.Description) > descriptionMaxLength {
		return NewValidationErrorWithCause(
			"document.description",
			d.Description,
			"max_length",
			"description must be at most 500 characters",
			ErrInvalidDescription,
		)
	}

	return nil
}
