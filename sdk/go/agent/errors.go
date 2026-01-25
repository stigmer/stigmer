package agent

import (
	"errors"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Common errors that can occur when working with agents.
var (
	// ErrInvalidName is returned when an agent name is invalid.
	ErrInvalidName = errors.New("invalid agent name")

	// ErrInvalidInstructions is returned when agent instructions are invalid.
	ErrInvalidInstructions = errors.New("invalid agent instructions")

	// ErrInvalidDescription is returned when agent description is invalid.
	ErrInvalidDescription = errors.New("invalid agent description")

	// ErrInvalidIconURL is returned when the icon URL is invalid.
	ErrInvalidIconURL = errors.New("invalid icon URL")

	// ErrMissingRequiredField is returned when a required field is missing.
	ErrMissingRequiredField = errors.New("missing required field")

	// ErrConversion is returned when proto conversion fails.
	ErrConversion = errors.New("proto conversion failed")
)

// ValidationError is an alias to the shared validation error type.
// This maintains backward compatibility with existing code that uses agent.ValidationError.
type ValidationError = validation.ValidationError

// ConversionError is an alias to the shared conversion error type.
// This maintains backward compatibility with existing code that uses agent.ConversionError.
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
