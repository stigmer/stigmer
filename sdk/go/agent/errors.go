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

// =============================================================================
// Resource Errors
// =============================================================================

// ResourceError is an alias to the shared resource error type.
// This provides context about which agent failed and during what operation.
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

// NewResourceError creates a new resource error for an agent.
// This is a convenience wrapper that pre-fills ResourceType as "Agent".
//
// Example:
//
//	err := agent.NewResourceError("code-reviewer", "validation", "missing instructions")
func NewResourceError(name, operation, message string) *ResourceError {
	return validation.NewResourceError("Agent", name, operation, message)
}

// NewResourceErrorWithCause creates a new resource error for an agent with a cause.
// This is a convenience wrapper that pre-fills ResourceType as "Agent".
//
// Example:
//
//	err := agent.NewResourceErrorWithCause("code-reviewer", "validation", "name is required", ErrInvalidName)
func NewResourceErrorWithCause(name, operation, message string, err error) *ResourceError {
	return validation.NewResourceErrorWithCause("Agent", name, operation, message, err)
}

// =============================================================================
// SubAgent Errors
// =============================================================================

// Sentinel errors for skill reference parsing in SubAgent context.
//
// SubAgents differ from Agents in that they have no Org field.
// All skill references must use explicit "org/slug" format.
var (
	// ErrSubAgentOrgRequired is returned when a slug-only reference is used.
	// SubAgents have no org context, so explicit "org/slug" format is required.
	ErrSubAgentOrgRequired = errors.New("explicit org/slug format required (subagents have no org context)")

	// ErrSubAgentEmptyRef is returned when an empty reference string is provided.
	ErrSubAgentEmptyRef = errors.New("reference string is empty")

	// ErrSubAgentEmptyOrg is returned when the organization part of a reference is empty.
	ErrSubAgentEmptyOrg = errors.New("organization is empty in reference")

	// ErrSubAgentEmptySlug is returned when the slug part of a reference is empty.
	ErrSubAgentEmptySlug = errors.New("slug is empty in reference")
)

// SubAgentRefParseError provides detailed context for skill reference parsing failures
// in SubAgent context.
//
// This error type wraps sentinel errors and provides additional context
// for debugging and user-facing error messages.
//
// Use errors.Is() to check for specific error types:
//
//	var parseErr *SubAgentRefParseError
//	if errors.As(err, &parseErr) {
//	    fmt.Printf("Failed to parse %q: %s\n", parseErr.Ref, parseErr.Message)
//	}
//	if errors.Is(err, ErrSubAgentOrgRequired) {
//	    // Handle missing org specifically
//	}
type SubAgentRefParseError struct {
	// Ref is the original reference string that failed to parse.
	Ref string

	// Message provides a human-readable description of what went wrong.
	Message string

	// Err is the underlying sentinel error for programmatic error checking.
	Err error
}

// Error implements the error interface.
//
// Returns a formatted error message that includes:
// - Package context ("subagent:")
// - The original reference (if non-empty)
// - A human-readable explanation
func (e *SubAgentRefParseError) Error() string {
	if e.Ref == "" {
		return "subagent: " + e.Message
	}
	return "subagent: cannot parse \"" + e.Ref + "\": " + e.Message
}

// Unwrap returns the underlying error for use with errors.Is and errors.As.
//
// This allows callers to check for specific sentinel errors:
//
//	if errors.Is(err, ErrSubAgentOrgRequired) {
//	    // Show help about org/slug format
//	}
func (e *SubAgentRefParseError) Unwrap() error {
	return e.Err
}
