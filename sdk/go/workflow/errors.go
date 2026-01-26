package workflow

import (
	"errors"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Common errors that can occur when working with workflows.
var (
	// ErrInvalidNamespace is returned when a workflow namespace is invalid.
	ErrInvalidNamespace = errors.New("invalid workflow namespace")

	// ErrInvalidName is returned when a workflow name is invalid.
	ErrInvalidName = errors.New("invalid workflow name")

	// ErrInvalidVersion is returned when a workflow version is invalid.
	ErrInvalidVersion = errors.New("invalid workflow version")

	// ErrInvalidDescription is returned when a workflow description is invalid.
	ErrInvalidDescription = errors.New("invalid workflow description")

	// ErrNoTasks is returned when a workflow has no tasks.
	ErrNoTasks = errors.New("workflow must have at least one task")

	// ErrDuplicateTaskName is returned when a task name is duplicated.
	ErrDuplicateTaskName = errors.New("duplicate task name")

	// ErrInvalidTaskName is returned when a task name is invalid.
	ErrInvalidTaskName = errors.New("invalid task name")

	// ErrInvalidTaskKind is returned when a task kind is invalid.
	ErrInvalidTaskKind = errors.New("invalid task kind")

	// ErrInvalidTaskConfig is returned when a task configuration is invalid.
	ErrInvalidTaskConfig = errors.New("invalid task configuration")

	// ErrMissingRequiredField is returned when a required field is missing.
	ErrMissingRequiredField = errors.New("missing required field")

	// ErrConversion is returned when proto conversion fails.
	ErrConversion = errors.New("proto conversion failed")
)

// ValidationError is an alias to the shared validation error type.
// This maintains backward compatibility with existing code that uses workflow.ValidationError.
type ValidationError = validation.ValidationError

// ConversionError is an alias to the shared conversion error type.
// This maintains backward compatibility with existing code that uses workflow.ConversionError.
type ConversionError = validation.ConversionError

// NewValidationError creates a new validation error.
// This is a convenience wrapper around the shared validation package.
func NewValidationError(field, value, rule, message string) *ValidationError {
	return validation.NewValidationError(field, value, rule, message)
}

// NewValidationErrorWithCause creates a new validation error with an underlying cause.
// This is a convenience wrapper around the shared validation package.
func NewValidationErrorWithCause(field, value, rule, message string, err error) *ValidationError {
	return validation.NewValidationErrorWithCause(field, value, rule, message, err)
}

// NewConversionError creates a new conversion error.
// This is a convenience wrapper around the shared validation package.
func NewConversionError(typeName, field, message string) *ConversionError {
	return validation.NewConversionError(typeName, field, message)
}

// NewConversionErrorWithCause creates a new conversion error with an underlying cause.
// This is a convenience wrapper around the shared validation package.
func NewConversionErrorWithCause(typeName, field, message string, err error) *ConversionError {
	return validation.NewConversionErrorWithCause(typeName, field, message, err)
}

// =============================================================================
// Resource Errors
// =============================================================================

// ResourceError is an alias to the shared resource error type.
// This provides context about which workflow failed and during what operation.
type ResourceError = validation.ResourceError

// SynthesisError is an alias to the shared synthesis error type.
// This provides context about synthesis failures.
type SynthesisError = validation.SynthesisError

// Synthesis sentinel errors re-exported for convenience.
var (
	// ErrSynthesisAlreadyDone indicates synthesis was already performed.
	ErrSynthesisAlreadyDone = validation.ErrSynthesisAlreadyDone

	// ErrSynthesisFailed indicates the synthesis operation failed.
	ErrSynthesisFailed = validation.ErrSynthesisFailed

	// ErrManifestWrite indicates a failure to write a manifest file.
	ErrManifestWrite = validation.ErrManifestWrite
)

// NewResourceError creates a new resource error for a workflow.
// This is a convenience wrapper that pre-fills ResourceType as "Workflow".
//
// Example:
//
//	err := workflow.NewResourceError("data-pipeline", "validation", "missing tasks")
func NewResourceError(name, operation, message string) *ResourceError {
	return validation.NewResourceError("Workflow", name, operation, message)
}

// NewResourceErrorWithCause creates a new resource error for a workflow with a cause.
// This is a convenience wrapper that pre-fills ResourceType as "Workflow".
//
// Example:
//
//	err := workflow.NewResourceErrorWithCause("data-pipeline", "validation", "name is required", ErrInvalidName)
func NewResourceErrorWithCause(name, operation, message string, err error) *ResourceError {
	return validation.NewResourceErrorWithCause("Workflow", name, operation, message, err)
}
