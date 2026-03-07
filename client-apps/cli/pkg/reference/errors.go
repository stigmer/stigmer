package reference

import (
	"errors"
	"fmt"
)

// Sentinel errors for reference parsing failures.
var (
	// ErrEmptyReference indicates the reference string was empty.
	ErrEmptyReference = errors.New("reference is empty")

	// ErrEmptyOrg indicates the organization part was empty in an org/slug reference.
	ErrEmptyOrg = errors.New("organization is empty")

	// ErrEmptySlug indicates the slug part was empty in an org/slug reference.
	ErrEmptySlug = errors.New("slug is empty")

	// ErrOrgRequired indicates a slug-only reference was provided without a context organization.
	ErrOrgRequired = errors.New("organization required for slug-only reference")

	// ErrIncompleteID indicates a resource ID has the correct prefix but an
	// invalid ULID body (wrong length or characters).
	ErrIncompleteID = errors.New("incomplete resource ID")

	// ErrNotResourceID indicates the value does not match any known resource ID prefix.
	ErrNotResourceID = errors.New("not a resource ID")
)

// ParseError provides context about a reference parsing failure.
type ParseError struct {
	// Input is the original reference string that failed to parse.
	Input string

	// Message describes the specific parsing failure.
	Message string

	// Err is the underlying sentinel error.
	Err error
}

// Error implements the error interface.
func (e *ParseError) Error() string {
	if e.Input == "" {
		return fmt.Sprintf("reference: %s", e.Message)
	}
	return fmt.Sprintf("reference: %s: %q", e.Message, e.Input)
}

// Unwrap returns the underlying error for errors.Is/As support.
func (e *ParseError) Unwrap() error {
	return e.Err
}

// newParseError creates a ParseError with the given context.
func newParseError(input, message string, err error) *ParseError {
	return &ParseError{
		Input:   input,
		Message: message,
		Err:     err,
	}
}
