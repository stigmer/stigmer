package validation

import (
	"errors"
	"fmt"
)

// Sentinel errors for validation rules.
// These enable errors.Is() matching for programmatic error handling.
var (
	// ErrRequired indicates a required field was empty or nil.
	ErrRequired = errors.New("field is required")

	// ErrMinLength indicates a value was below the minimum length.
	ErrMinLength = errors.New("value below minimum length")

	// ErrMaxLength indicates a value exceeded the maximum length.
	ErrMaxLength = errors.New("value exceeds maximum length")

	// ErrInvalidFormat indicates a value did not match the expected format.
	ErrInvalidFormat = errors.New("invalid format")

	// ErrInvalidURL indicates an invalid URL was provided.
	ErrInvalidURL = errors.New("invalid URL")

	// ErrOutOfRange indicates a numeric value was outside the allowed range.
	ErrOutOfRange = errors.New("value out of range")

	// ErrInvalidEnum indicates a value was not one of the allowed values.
	ErrInvalidEnum = errors.New("invalid enum value")

	// ErrConversion indicates a proto conversion failed.
	ErrConversion = errors.New("proto conversion failed")
)

// ValidationError represents a validation error with structured context.
//
// It provides:
//   - Field: the full path to the invalid field (e.g., "volumes[2].host_path")
//   - Value: the invalid value (truncated if very long)
//   - Rule: the validation rule that failed (e.g., "required", "min_length")
//   - Message: a human-readable error message
//   - Err: an underlying sentinel error for errors.Is() matching
//
// Example:
//
//	err := &ValidationError{
//	    Field:   "config.timeout_seconds",
//	    Value:   "-5",
//	    Rule:    "range",
//	    Message: "timeout must be between 0 and 300 seconds",
//	    Err:     ErrOutOfRange,
//	}
//	if errors.Is(err, ErrOutOfRange) {
//	    // Handle out of range error
//	}
type ValidationError struct {
	Field   string // The field that failed validation (e.g., "volumes[2].host_path")
	Value   string // The value that was invalid (may be truncated)
	Rule    string // The validation rule that failed (e.g., "required", "min_length")
	Message string // Human-readable error message
	Err     error  // Underlying sentinel error for errors.Is()
}

// Error implements the error interface.
func (e *ValidationError) Error() string {
	if e.Field != "" {
		return fmt.Sprintf("validation failed for field %q: %s", e.Field, e.Message)
	}
	return fmt.Sprintf("validation failed: %s", e.Message)
}

// Unwrap returns the underlying error for error chain traversal.
func (e *ValidationError) Unwrap() error {
	return e.Err
}

// Is implements error matching for sentinel errors.
// This enables errors.Is(err, ErrRequired) to work correctly.
func (e *ValidationError) Is(target error) bool {
	return e.Err != nil && errors.Is(e.Err, target)
}

// NewValidationError creates a new validation error.
//
// Parameters:
//   - field: the field path (e.g., "name", "config.timeout")
//   - value: the invalid value
//   - rule: the validation rule that failed
//   - message: human-readable error message
func NewValidationError(field, value, rule, message string) *ValidationError {
	return &ValidationError{
		Field:   field,
		Value:   truncateValue(value),
		Rule:    rule,
		Message: message,
	}
}

// NewValidationErrorWithCause creates a new validation error with an underlying cause.
//
// The cause enables errors.Is() matching against sentinel errors.
//
// Parameters:
//   - field: the field path (e.g., "name", "config.timeout")
//   - value: the invalid value
//   - rule: the validation rule that failed
//   - message: human-readable error message
//   - err: underlying sentinel error (e.g., ErrRequired)
func NewValidationErrorWithCause(field, value, rule, message string, err error) *ValidationError {
	return &ValidationError{
		Field:   field,
		Value:   truncateValue(value),
		Rule:    rule,
		Message: message,
		Err:     err,
	}
}

// ConversionError represents an error during proto conversion.
//
// It provides context about which type and field caused the conversion failure.
type ConversionError struct {
	Type    string // The type being converted (e.g., "Agent", "Workflow")
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

// Unwrap returns the underlying error for error chain traversal.
func (e *ConversionError) Unwrap() error {
	return e.Err
}

// NewConversionError creates a new conversion error.
//
// Parameters:
//   - typeName: the type being converted (e.g., "Agent")
//   - field: the field that caused the error (can be empty)
//   - message: human-readable error message
func NewConversionError(typeName, field, message string) *ConversionError {
	return &ConversionError{
		Type:    typeName,
		Field:   field,
		Message: message,
	}
}

// NewConversionErrorWithCause creates a new conversion error with an underlying cause.
//
// Parameters:
//   - typeName: the type being converted (e.g., "Agent")
//   - field: the field that caused the error (can be empty)
//   - message: human-readable error message
//   - err: underlying error
func NewConversionErrorWithCause(typeName, field, message string, err error) *ConversionError {
	return &ConversionError{
		Type:    typeName,
		Field:   field,
		Message: message,
		Err:     err,
	}
}

// truncateValue truncates long values for error messages.
// Values longer than 50 characters are truncated with "...".
func truncateValue(value string) string {
	const maxLen = 50
	if len(value) > maxLen {
		return value[:maxLen-3] + "..."
	}
	return value
}
