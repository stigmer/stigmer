package mcpserver

import (
	"errors"
	"fmt"
)

// Sentinel errors for MCP server reference parsing.
var (
	// ErrInvalidFormat is returned when the MCP server reference format is invalid.
	// Valid format is "org/slug".
	ErrInvalidFormat = errors.New("invalid MCP server reference format")

	// ErrEmptyOrg is returned when the organization part of a reference is empty.
	ErrEmptyOrg = errors.New("organization cannot be empty")

	// ErrEmptySlug is returned when the slug part of a reference is empty.
	ErrEmptySlug = errors.New("slug cannot be empty")
)

// ParseError provides detailed context for parsing failures.
//
// It wraps one of the sentinel errors (ErrInvalidFormat, ErrEmptyOrg, ErrEmptySlug)
// with additional context about the input that caused the error.
type ParseError struct {
	// Input is the original reference string that failed to parse.
	Input string

	// Message provides a human-readable description of what went wrong.
	Message string

	// Err is the underlying sentinel error.
	Err error
}

// Error implements the error interface.
func (e *ParseError) Error() string {
	if e.Input == "" {
		return fmt.Sprintf("mcpserver: %s", e.Message)
	}
	return fmt.Sprintf("mcpserver: %s (input: %q)", e.Message, e.Input)
}

// Unwrap returns the underlying error for use with errors.Is and errors.As.
func (e *ParseError) Unwrap() error {
	return e.Err
}
