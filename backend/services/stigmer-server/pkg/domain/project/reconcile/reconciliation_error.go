package reconcile

import "fmt"

// ReconciliationError represents an error that occurred during reconciliation execution.
//
// ReconciliationError tracks failures during the execution phase of reconciliation.
// When a resource fails to create, update, or delete, a ReconciliationError is recorded
// with the resource key, a human-readable message, and optionally the underlying error.
//
// This is a value type (not a pointer) for easy copying and comparison.
// It implements the error interface for compatibility with Go's error handling.
//
// Example:
//
//	err := NewReconciliationError("agent:my-agent", "failed to create agent")
//	fmt.Println(err.Error()) // Output: agent:my-agent: failed to create agent
//
//	errWithCause := NewReconciliationErrorWithCause(
//	    "workflow:pipeline",
//	    "database connection failed",
//	    dbErr,
//	)
//	fmt.Println(errWithCause.HasCause()) // Output: true
type ReconciliationError struct {
	resourceKey string
	message     string
	cause       error
}

// NewReconciliationError creates a ReconciliationError without an underlying cause.
//
// Use this when you have a descriptive error message but no underlying error.
//
// Example:
//
//	err := NewReconciliationError("agent:my-agent", "validation failed: missing spec")
func NewReconciliationError(resourceKey, message string) ReconciliationError {
	return ReconciliationError{
		resourceKey: resourceKey,
		message:     message,
		cause:       nil,
	}
}

// NewReconciliationErrorWithCause creates a ReconciliationError with an underlying cause.
//
// Use this when you have an underlying error to preserve the error chain.
//
// Example:
//
//	err := NewReconciliationErrorWithCause("agent:my-agent", "create failed", originalErr)
func NewReconciliationErrorWithCause(resourceKey, message string, cause error) ReconciliationError {
	return ReconciliationError{
		resourceKey: resourceKey,
		message:     message,
		cause:       cause,
	}
}

// ResourceKey returns the resource key identifying which resource failed.
//
// Format: "{kind}:{slug}" (e.g., "agent:my-agent", "workflow:data-pipeline")
func (e ReconciliationError) ResourceKey() string {
	return e.resourceKey
}

// Message returns the human-readable error message.
func (e ReconciliationError) Message() string {
	return e.message
}

// Cause returns the underlying error, or nil if there is no cause.
func (e ReconciliationError) Cause() error {
	return e.cause
}

// HasCause returns true if there is an underlying error cause.
func (e ReconciliationError) HasCause() bool {
	return e.cause != nil
}

// Error implements the error interface.
//
// Returns a formatted string combining resource key and message.
// If there's an underlying cause, it is appended.
//
// Format: "{resourceKey}: {message}" or "{resourceKey}: {message}: {cause}"
func (e ReconciliationError) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.resourceKey, e.message, e.cause)
	}
	return fmt.Sprintf("%s: %s", e.resourceKey, e.message)
}

// Unwrap returns the underlying error cause for use with errors.Is and errors.As.
//
// Implements the standard library's error unwrapping convention.
func (e ReconciliationError) Unwrap() error {
	return e.cause
}
