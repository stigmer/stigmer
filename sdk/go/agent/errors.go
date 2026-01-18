package agent

import (
	"errors"
	"fmt"
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

// ValidationError represents a validation error with context.
type ValidationError struct {
	Field   string // The field that failed validation
	Value   string // The value that was invalid
	Rule    string // The validation rule that failed
	Message string // Human-readable error message
	Err     error  // Underlying error, if any
}

// Error implements the error interface.
func (e *ValidationError) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("validation failed for field %q: %s", e.Field, e.Message)
	}
	return fmt.Sprintf("validation failed: %s", e.Message)
}

// Unwrap returns the underlying error.
func (e *ValidationError) Unwrap() error {
	return e.Err
}

// Is implements error matching for sentinel errors.
func (e *ValidationError) Is(target error) bool {
	return e.Err != nil && errors.Is(e.Err, target)
}

// NewValidationError creates a new validation error.
func NewValidationError(field, value, rule, message string) *ValidationError {
	return &ValidationError{
		Field:   field,
		Value:   value,
		Rule:    rule,
		Message: message,
	}
}

// NewValidationErrorWithCause creates a new validation error with an underlying cause.
func NewValidationErrorWithCause(field, value, rule, message string, err error) *ValidationError {
	return &ValidationError{
		Field:   field,
		Value:   value,
		Rule:    rule,
		Message: message,
		Err:     err,
	}
}

// ConversionError represents an error during proto conversion.
type ConversionError struct {
	Type    string // The type being converted
	Field   string // The field that caused the error (optional)
	Message string // Human-readable error message
	Err     error  // Underlying error, if any
}

// Error implements the error interface.
func (e *ConversionError) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("failed to convert %s.%s: %s", e.Type, e.Field, e.Message)
	}
	return fmt.Sprintf("failed to convert %s: %s", e.Type, e.Message)
}

// Unwrap returns the underlying error.
func (e *ConversionError) Unwrap() error {
	return e.Err
}

// NewConversionError creates a new conversion error.
func NewConversionError(typeName, field, message string) *ConversionError {
	return &ConversionError{
		Type:    typeName,
		Field:   field,
		Message: message,
	}
}

// NewConversionErrorWithCause creates a new conversion error with an underlying cause.
func NewConversionErrorWithCause(typeName, field, message string, err error) *ConversionError {
	return &ConversionError{
		Type:    typeName,
		Field:   field,
		Message: message,
		Err:     err,
	}
}
