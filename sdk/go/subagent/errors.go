package subagent

import (
	"errors"
	"fmt"
)

// Sentinel errors for skill reference parsing in subagent context.
//
// SubAgents differ from Agents in that they have no Org field.
// All skill references must use explicit "org/slug" format.
var (
	// ErrOrgRequired is returned when a slug-only reference is used.
	// SubAgents have no org context, so explicit "org/slug" format is required.
	ErrOrgRequired = errors.New("explicit org/slug format required (subagents have no org context)")

	// ErrEmptyRef is returned when an empty reference string is provided.
	ErrEmptyRef = errors.New("reference string is empty")

	// ErrEmptyOrg is returned when the organization part of a reference is empty.
	ErrEmptyOrg = errors.New("organization is empty in reference")

	// ErrEmptySlug is returned when the slug part of a reference is empty.
	ErrEmptySlug = errors.New("slug is empty in reference")
)

// RefParseError provides detailed context for skill reference parsing failures.
//
// This error type wraps sentinel errors and provides additional context
// for debugging and user-facing error messages.
//
// Use errors.Is() to check for specific error types:
//
//	var parseErr *RefParseError
//	if errors.As(err, &parseErr) {
//	    fmt.Printf("Failed to parse %q: %s\n", parseErr.Ref, parseErr.Message)
//	}
//	if errors.Is(err, ErrOrgRequired) {
//	    // Handle missing org specifically
//	}
type RefParseError struct {
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
func (e *RefParseError) Error() string {
	if e.Ref == "" {
		return fmt.Sprintf("subagent: %s", e.Message)
	}
	return fmt.Sprintf("subagent: cannot parse %q: %s", e.Ref, e.Message)
}

// Unwrap returns the underlying error for use with errors.Is and errors.As.
//
// This allows callers to check for specific sentinel errors:
//
//	if errors.Is(err, ErrOrgRequired) {
//	    // Show help about org/slug format
//	}
func (e *RefParseError) Unwrap() error {
	return e.Err
}
