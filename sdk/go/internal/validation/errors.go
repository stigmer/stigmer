package validation

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
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

// =============================================================================
// Resource Errors
// =============================================================================

// ResourceError represents an error associated with a specific Stigmer resource.
// It provides context about which resource failed and during what operation.
//
// This follows the Pulumi pattern of including resource identification in errors,
// enabling better diagnostics when multiple resources are being processed.
//
// Example:
//
//	err := &ResourceError{
//	    ResourceType: "Agent",
//	    ResourceName: "code-reviewer",
//	    Operation:    "validation",
//	    Message:      "missing required instructions",
//	    Err:          ErrRequired,
//	}
//	if errors.Is(err, ErrRequired) {
//	    // Handle required field error
//	}
type ResourceError struct {
	ResourceType string // The type of resource (e.g., "Agent", "Workflow")
	ResourceName string // The name of the resource (e.g., "code-reviewer")
	Operation    string // The operation that failed (e.g., "validation", "synthesis", "conversion")
	Message      string // Human-readable error message
	Err          error  // Underlying error for unwrapping
}

// Error implements the error interface.
func (e *ResourceError) Error() string {
	if e.ResourceName != "" {
		return fmt.Sprintf("%s %q %s failed: %s",
			e.ResourceType, e.ResourceName, e.Operation, e.Message)
	}
	return fmt.Sprintf("%s %s failed: %s", e.ResourceType, e.Operation, e.Message)
}

// Unwrap returns the underlying error for error chain traversal.
func (e *ResourceError) Unwrap() error {
	return e.Err
}

// Is implements error matching for sentinel errors.
// This enables errors.Is(err, ErrRequired) to work correctly.
func (e *ResourceError) Is(target error) bool {
	if e.Err == nil {
		return false
	}
	return errors.Is(e.Err, target)
}

// WithField returns a new ValidationError with additional field context.
// This creates a ValidationError with the resource context preserved in the field path.
//
// Example:
//
//	resErr := NewResourceError("Agent", "code-reviewer", "validation", "invalid field")
//	fieldErr := resErr.WithField("instructions", "", "required")
//	// fieldErr.Field = "agent.instructions"
func (e *ResourceError) WithField(field, value, rule string) *ValidationError {
	return &ValidationError{
		Field:   fmt.Sprintf("%s.%s", strings.ToLower(e.ResourceType), field),
		Value:   truncateValue(value),
		Rule:    rule,
		Message: e.Message,
		Err:     e.Err,
	}
}

// NewResourceError creates a new resource error.
//
// Parameters:
//   - resourceType: the type of resource (e.g., "Agent", "Workflow")
//   - resourceName: the name of the resource
//   - operation: the operation that failed (e.g., "validation", "synthesis")
//   - message: human-readable error message
func NewResourceError(resourceType, resourceName, operation, message string) *ResourceError {
	return &ResourceError{
		ResourceType: resourceType,
		ResourceName: resourceName,
		Operation:    operation,
		Message:      message,
	}
}

// NewResourceErrorWithCause creates a new resource error with an underlying cause.
//
// Parameters:
//   - resourceType: the type of resource (e.g., "Agent", "Workflow")
//   - resourceName: the name of the resource
//   - operation: the operation that failed
//   - message: human-readable error message
//   - err: underlying error for unwrapping and errors.Is() matching
func NewResourceErrorWithCause(resourceType, resourceName, operation, message string, err error) *ResourceError {
	return &ResourceError{
		ResourceType: resourceType,
		ResourceName: resourceName,
		Operation:    operation,
		Message:      message,
		Err:          err,
	}
}

// ResourceErrorf creates a new resource error with a formatted message.
//
// Parameters:
//   - resourceType: the type of resource (e.g., "Agent", "Workflow")
//   - resourceName: the name of the resource
//   - operation: the operation that failed
//   - format: format string for the message
//   - args: format arguments
func ResourceErrorf(resourceType, resourceName, operation, format string, args ...any) *ResourceError {
	return &ResourceError{
		ResourceType: resourceType,
		ResourceName: resourceName,
		Operation:    operation,
		Message:      fmt.Sprintf(format, args...),
	}
}

// =============================================================================
// Synthesis Errors
// =============================================================================

// Sentinel errors for synthesis operations.
var (
	// ErrSynthesisAlreadyDone indicates synthesis was already performed on this context.
	ErrSynthesisAlreadyDone = errors.New("synthesis already performed")

	// ErrSynthesisFailed indicates the synthesis operation failed.
	ErrSynthesisFailed = errors.New("synthesis failed")

	// ErrManifestWrite indicates a failure to write a manifest file.
	ErrManifestWrite = errors.New("failed to write manifest")
)

// SynthesisError represents an error during the synthesis phase.
// It wraps errors that occur when converting SDK types to protobuf
// or writing manifests to disk.
//
// SynthesisError provides context about:
//   - Phase: which synthesis phase failed (e.g., "agents", "workflows", "dependencies")
//   - ResourceType: the type of resource being synthesized (if applicable)
//   - ResourceName: the name of the specific resource (if applicable)
//
// Example:
//
//	err := &SynthesisError{
//	    Phase:        "agents",
//	    ResourceType: "Agent",
//	    ResourceName: "code-reviewer",
//	    Message:      "failed to convert to proto",
//	    Err:          originalErr,
//	}
type SynthesisError struct {
	Phase        string // The synthesis phase (e.g., "agents", "workflows", "dependencies")
	ResourceType string // Optional: the type of resource being synthesized
	ResourceName string // Optional: the name of the resource
	Message      string // Human-readable error message
	Err          error  // Underlying error
}

// Error implements the error interface.
func (e *SynthesisError) Error() string {
	var b strings.Builder
	b.WriteString("synthesis")
	if e.Phase != "" {
		b.WriteString(" [")
		b.WriteString(e.Phase)
		b.WriteString("]")
	}
	if e.ResourceType != "" {
		b.WriteString(" ")
		b.WriteString(e.ResourceType)
		if e.ResourceName != "" {
			b.WriteString(" ")
			b.WriteString(strconv.Quote(e.ResourceName))
		}
	}
	b.WriteString(" failed: ")
	b.WriteString(e.Message)
	return b.String()
}

// Unwrap returns the underlying error for error chain traversal.
func (e *SynthesisError) Unwrap() error {
	return e.Err
}

// Is implements error matching for sentinel errors.
func (e *SynthesisError) Is(target error) bool {
	if e.Err == nil {
		return false
	}
	return errors.Is(e.Err, target)
}

// NewSynthesisError creates a new synthesis error for a phase.
//
// Parameters:
//   - phase: the synthesis phase that failed (e.g., "agents", "workflows")
//   - message: human-readable error message
func NewSynthesisError(phase, message string) *SynthesisError {
	return &SynthesisError{
		Phase:   phase,
		Message: message,
		Err:     ErrSynthesisFailed,
	}
}

// NewSynthesisErrorWithCause creates a new synthesis error with an underlying cause.
//
// Parameters:
//   - phase: the synthesis phase that failed
//   - message: human-readable error message
//   - err: underlying error
func NewSynthesisErrorWithCause(phase, message string, err error) *SynthesisError {
	return &SynthesisError{
		Phase:   phase,
		Message: message,
		Err:     err,
	}
}

// NewSynthesisErrorForResource creates a synthesis error for a specific resource.
//
// Parameters:
//   - phase: the synthesis phase that failed
//   - resourceType: the type of resource (e.g., "Agent", "Workflow")
//   - resourceName: the name of the resource
//   - message: human-readable error message
//   - err: underlying error
func NewSynthesisErrorForResource(phase, resourceType, resourceName, message string, err error) *SynthesisError {
	return &SynthesisError{
		Phase:        phase,
		ResourceType: resourceType,
		ResourceName: resourceName,
		Message:      message,
		Err:          err,
	}
}

// =============================================================================
// Helpers
// =============================================================================

// truncateValue truncates long values for error messages.
// Values longer than 50 characters are truncated with "...".
func truncateValue(value string) string {
	const maxLen = 50
	if len(value) > maxLen {
		return value[:maxLen-3] + "..."
	}
	return value
}
