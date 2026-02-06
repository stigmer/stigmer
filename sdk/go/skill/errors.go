package skill

import (
	"errors"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Common errors that can occur when working with skills.
var (
	// ErrPathRequired is returned when a path is not provided for FromDir.
	ErrPathRequired = errors.New("skill: path is required for FromDir")

	// ErrUrlRequired is returned when a URL is not provided for FromGit.
	ErrUrlRequired = errors.New("skill: url is required for FromGit")

	// ErrSourceNil is returned when the skill source is not set during proto conversion.
	ErrSourceNil = errors.New("skill: source is nil, cannot convert to proto")

	// ErrConversion is returned when proto conversion fails.
	ErrConversion = errors.New("skill: proto conversion failed")
)

// ValidationError is an alias to the shared validation error type.
// This maintains backward compatibility with existing code that uses skill.ValidationError.
type ValidationError = validation.ValidationError

// ConversionError is an alias to the shared conversion error type.
// This maintains backward compatibility with existing code that uses skill.ConversionError.
type ConversionError = validation.ConversionError

// =============================================================================
// Resource Errors
// =============================================================================

// ResourceError is an alias to the shared resource error type.
// This provides context about which skill failed and during what operation.
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

// NewResourceError creates a new resource error for a skill.
// This is a convenience wrapper that pre-fills ResourceType as "Skill".
//
// Example:
//
//	err := skill.NewResourceError("calculator", "synthesis", "source not set")
func NewResourceError(name, operation, message string) *ResourceError {
	return validation.NewResourceError("Skill", name, operation, message)
}

// NewResourceErrorWithCause creates a new resource error for a skill with a cause.
// This is a convenience wrapper that pre-fills ResourceType as "Skill".
//
// Example:
//
//	err := skill.NewResourceErrorWithCause("calculator", "validation", "path is required", ErrPathRequired)
func NewResourceErrorWithCause(name, operation, message string, err error) *ResourceError {
	return validation.NewResourceErrorWithCause("Skill", name, operation, message, err)
}
