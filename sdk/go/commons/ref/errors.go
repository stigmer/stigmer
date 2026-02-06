package ref

import (
	"errors"
	"fmt"
)

// Sentinel errors for reference parsing.
//
// These errors can be checked using errors.Is:
//
//	if errors.Is(err, ref.ErrInvalidFormat) {
//	    // handle invalid format
//	}
var (
	// ErrInvalidFormat is returned when the reference format is invalid.
	// Valid formats are "org/slug" or "org/slug@version" (for versioned resources).
	ErrInvalidFormat = errors.New("invalid reference format")

	// ErrEmptyOrg is returned when the organization part of a reference is empty.
	ErrEmptyOrg = errors.New("organization cannot be empty")

	// ErrEmptySlug is returned when the slug part of a reference is empty.
	ErrEmptySlug = errors.New("slug cannot be empty")
)

// ParseError provides detailed context for parsing failures.
//
// It wraps one of the sentinel errors (ErrInvalidFormat, ErrEmptyOrg, ErrEmptySlug)
// with additional context about the resource kind and input that caused the error.
//
// ParseError supports both errors.Is and errors.As:
//
//	var parseErr *ref.ParseError
//	if errors.As(err, &parseErr) {
//	    fmt.Printf("Failed to parse %s reference: %s\n", parseErr.Kind, parseErr.Message)
//	}
type ParseError struct {
	// Kind identifies the resource type (e.g., "skill", "mcp_server").
	Kind string

	// Input is the original reference string that failed to parse.
	Input string

	// Message provides a human-readable description of what went wrong.
	Message string

	// Err is the underlying sentinel error.
	Err error
}

// Error implements the error interface.
//
// Format: "ref: <kind>: <message> (input: "<input>")"
// If input is empty: "ref: <kind>: <message>"
func (e *ParseError) Error() string {
	if e.Input == "" {
		return fmt.Sprintf("ref: %s: %s", e.Kind, e.Message)
	}
	return fmt.Sprintf("ref: %s: %s (input: %q)", e.Kind, e.Message, e.Input)
}

// Unwrap returns the underlying error for use with errors.Is and errors.As.
func (e *ParseError) Unwrap() error {
	return e.Err
}

// newParseError creates a new ParseError with the given parameters.
func newParseError(kind, input, message string, err error) *ParseError {
	return &ParseError{
		Kind:    kind,
		Input:   input,
		Message: message,
		Err:     err,
	}
}
