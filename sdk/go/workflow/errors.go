// errors.go provides error types, constants, and matchers for workflow tasks.
//
// This file consolidates all error-related functionality:
//   - Sentinel errors for common workflow failures
//   - Platform error type constants (SDK ←→ Backend contract)
//   - Error type metadata registry for documentation and tooling
//   - ErrorMatcher for type-safe, composable error matching in CATCH blocks

package workflow

import (
	"errors"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// =============================================================================
// Sentinel Errors
// =============================================================================

// Common errors that can occur when working with workflows.
var (
	// ErrInvalidNamespace is returned when a workflow namespace is invalid.
	ErrInvalidNamespace = errors.New("invalid workflow namespace")

	// ErrInvalidName is returned when a workflow name is invalid.
	ErrInvalidName = errors.New("invalid workflow name")

	// ErrInvalidVersion is returned when a workflow version is invalid.
	ErrInvalidVersion = errors.New("invalid workflow version")

	// ErrInvalidDescription is returned when a workflow description is invalid.
	ErrInvalidDescription = errors.New("invalid workflow description")

	// ErrNoTasks is returned when a workflow has no tasks.
	ErrNoTasks = errors.New("workflow must have at least one task")

	// ErrDuplicateTaskName is returned when a task name is duplicated.
	ErrDuplicateTaskName = errors.New("duplicate task name")

	// ErrInvalidTaskName is returned when a task name is invalid.
	ErrInvalidTaskName = errors.New("invalid task name")

	// ErrInvalidTaskKind is returned when a task kind is invalid.
	ErrInvalidTaskKind = errors.New("invalid task kind")

	// ErrInvalidTaskConfig is returned when a task configuration is invalid.
	ErrInvalidTaskConfig = errors.New("invalid task configuration")

	// ErrMissingRequiredField is returned when a required field is missing.
	ErrMissingRequiredField = errors.New("missing required field")

	// ErrArgsNil is returned when Args is unexpectedly nil.
	ErrArgsNil = errors.New("workflow args is nil")

	// ErrConversion is returned when proto conversion fails.
	ErrConversion = errors.New("proto conversion failed")

	// ErrTaskConversion is returned when task conversion fails.
	ErrTaskConversion = errors.New("task conversion failed")
)

// =============================================================================
// Validation and Conversion Error Types
// =============================================================================

// ValidationError is an alias to the shared validation error type.
// This maintains backward compatibility with existing code that uses workflow.ValidationError.
type ValidationError = validation.ValidationError

// ConversionError is an alias to the shared conversion error type.
// This maintains backward compatibility with existing code that uses workflow.ConversionError.
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
// This provides context about which workflow failed and during what operation.
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

// NewResourceError creates a new resource error for a workflow.
// This is a convenience wrapper that pre-fills ResourceType as "Workflow".
//
// Example:
//
//	err := workflow.NewResourceError("data-pipeline", "validation", "missing tasks")
func NewResourceError(name, operation, message string) *ResourceError {
	return validation.NewResourceError("Workflow", name, operation, message)
}

// NewResourceErrorWithCause creates a new resource error for a workflow with a cause.
// This is a convenience wrapper that pre-fills ResourceType as "Workflow".
//
// Example:
//
//	err := workflow.NewResourceErrorWithCause("data-pipeline", "validation", "name is required", ErrInvalidName)
func NewResourceErrorWithCause(name, operation, message string, err error) *ResourceError {
	return validation.NewResourceErrorWithCause("Workflow", name, operation, message, err)
}

// =============================================================================
// Platform Error Type Constants
// =============================================================================

// Error types generated by the Stigmer workflow runtime.
//
// These constants represent the actual error types that can be caught in TRY/CATCH blocks.
// They match the error types generated by the workflow-runner backend when tasks fail.
//
// IMPORTANT: These are NOT arbitrary strings - they must match the error types
// defined in the backend workflow runner. Do not change these values without
// coordinating with the backend team.
//
// Contract: SDK ←→ Workflow Runner Backend
// The SDK must use these exact error type strings to catch errors generated by the platform.
const (
	// ErrorTypeHTTPCall is raised when HTTP_CALL tasks fail.
	// Covers 3xx redirects, 4xx client errors, and 5xx server errors.
	//
	// Source: HTTP_CALL tasks
	// When raised:
	//   - 3xx: Redirect encountered (non-retryable)
	//   - 4xx: Client error like 404, 400, 401, 403 (non-retryable)
	//   - 5xx: Server error like 500, 502, 503 (retryable)
	ErrorTypeHTTPCall = "CallHTTP error"

	// ErrorTypeGRPCCall is raised when GRPC_CALL tasks fail.
	// Covers proto file loading errors, argument serialization errors, and gRPC call failures.
	//
	// Source: GRPC_CALL tasks
	// When raised:
	//   - Proto file cannot be loaded
	//   - Arguments cannot be serialized to JSON
	//   - gRPC call fails (network, unavailable, deadline exceeded, etc.)
	ErrorTypeGRPCCall = "CallGRPC error"

	// ErrorTypeValidation is raised when workflow input validation fails.
	// This happens before workflow execution when input doesn't match the defined schema.
	//
	// Source: Workflow input validation (before execution)
	// When raised:
	//   - Input missing required fields
	//   - Input has wrong data types
	//   - Input violates schema constraints
	ErrorTypeValidation = "Validation"

	// ErrorTypeIfStatement is raised when if/when conditional evaluation fails.
	// This happens when expression parsing fails or returns an invalid type.
	//
	// Source: SWITCH task condition evaluation, task if/when guards
	// When raised:
	//   - Expression syntax is invalid
	//   - Expression returns non-boolean type
	ErrorTypeIfStatement = "If statement error"

	// ErrorTypeCommand is raised when RUN tasks (shell commands) fail.
	// This happens when a shell command exits with non-zero status.
	//
	// Source: RUN tasks
	// When raised:
	//   - Command exits with non-zero code
	//   - Command execution fails
	ErrorTypeCommand = "command"

	// ErrorTypeAny is a wildcard that catches ALL error types.
	// Use this as a fallback catch block to handle any unhandled errors.
	//
	// Source: Any task
	// When raised: Any error
	ErrorTypeAny = "*"
)

// =============================================================================
// Error Type Registry
// =============================================================================

// ErrorTypeInfo provides metadata about a platform error type.
// This is used for documentation, IDE support, and runtime validation.
type ErrorTypeInfo struct {
	// Code is the error type string (e.g., "CallHTTP error")
	Code string

	// Category groups related error types (e.g., "Network", "Validation")
	Category string

	// Source indicates which task type generates this error
	Source string

	// Retryable indicates if errors of this type are retryable by default
	// Note: Actual retryability can be configured per-task using retry policies
	Retryable bool

	// Description explains when this error occurs
	Description string

	// Examples provides common scenarios that trigger this error
	Examples []string
}

// ErrorRegistry contains metadata for all platform error types.
// This registry is used for:
//   - Documentation generation
//   - IDE autocomplete and hover tooltips
//   - Runtime validation (warning about unknown error types)
//   - CLI help commands
var ErrorRegistry = map[string]ErrorTypeInfo{
	ErrorTypeHTTPCall: {
		Code:      ErrorTypeHTTPCall,
		Category:  "Network",
		Source:    "HTTP_CALL tasks",
		Retryable: false, // 4xx=non-retryable, 5xx=retryable (same type)
		Description: "HTTP call failed with 3xx redirect, 4xx client error, or 5xx server error. " +
			"3xx and 4xx are non-retryable (requires code fix), 5xx are retryable (transient server issue).",
		Examples: []string{
			"404 Not Found - endpoint doesn't exist",
			"401 Unauthorized - invalid credentials",
			"500 Internal Server Error - server failure",
			"503 Service Unavailable - service overloaded",
			"Connection refused - server not reachable",
			"Timeout - request took too long",
		},
	},

	ErrorTypeGRPCCall: {
		Code:      ErrorTypeGRPCCall,
		Category:  "Network",
		Source:    "GRPC_CALL tasks",
		Retryable: false,
		Description: "gRPC call failed due to proto file loading error, argument serialization error, " +
			"or gRPC service unavailability.",
		Examples: []string{
			"Proto file not found",
			"Cannot parse proto schema",
			"Arguments don't match proto schema",
			"gRPC service unavailable",
			"gRPC deadline exceeded",
		},
	},

	ErrorTypeValidation: {
		Code:      ErrorTypeValidation,
		Category:  "Data",
		Source:    "Workflow input validation",
		Retryable: false,
		Description: "Workflow input validation failed against JSON schema. " +
			"This error occurs before workflow execution starts.",
		Examples: []string{
			"Missing required field 'userId'",
			"Field 'age' must be a number",
			"Email format is invalid",
			"Value exceeds maximum length",
		},
	},

	ErrorTypeIfStatement: {
		Code:      ErrorTypeIfStatement,
		Category:  "Expression",
		Source:    "SWITCH task conditions, if/when guards",
		Retryable: false,
		Description: "Conditional expression evaluation failed due to syntax error " +
			"or type mismatch (non-boolean result).",
		Examples: []string{
			"Expression syntax error",
			"Undefined variable in expression",
			"Expression returned non-boolean type",
		},
	},

	ErrorTypeCommand: {
		Code:        ErrorTypeCommand,
		Category:    "Execution",
		Source:      "RUN tasks",
		Retryable:   true,
		Description: "Shell command execution failed with non-zero exit code.",
		Examples: []string{
			"Command exited with code 1",
			"Script execution failed",
			"Command not found",
		},
	},

	ErrorTypeAny: {
		Code:        ErrorTypeAny,
		Category:    "Wildcard",
		Source:      "Any task",
		Retryable:   false, // Depends on the actual error
		Description: "Wildcard that matches ALL error types. Use as a catch-all fallback.",
		Examples: []string{
			"Catches any error not handled by previous catch blocks",
		},
	},
}

// GetErrorTypeInfo returns metadata for a given error type code.
// Returns (info, true) if the error type is a known platform type.
// Returns (zero, false) for user-defined error types or unknown types.
func GetErrorTypeInfo(code string) (ErrorTypeInfo, bool) {
	info, ok := ErrorRegistry[code]
	return info, ok
}

// ListPlatformErrorTypes returns all registered platform error types.
// This excludes user-defined error types and the wildcard "*".
func ListPlatformErrorTypes() []ErrorTypeInfo {
	types := make([]ErrorTypeInfo, 0, len(ErrorRegistry))
	for _, info := range ErrorRegistry {
		if info.Code != ErrorTypeAny {
			types = append(types, info)
		}
	}
	return types
}

// IsPlatformErrorType returns true if the given code is a known platform error type.
func IsPlatformErrorType(code string) bool {
	_, ok := ErrorRegistry[code]
	return ok
}

// =============================================================================
// Error Matcher
// =============================================================================

// ErrorMatcher provides a type-safe, composable way to match error types in CATCH blocks.
//
// Instead of using raw string slices for error types, ErrorMatcher provides:
//   - Discoverability: IDE autocomplete shows available error types
//   - Composability: Combine multiple error types with Or()
//   - Type safety: Compile-time validation instead of runtime typos
//   - Self-documentation: Clear intent with named functions
//
// Example usage:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchHTTPErrors(),  // Type-safe error matching
//	    "httpErr",
//	    workflow.SetTask("handleHTTPError", ...),
//	)
//
//	// Compose multiple error types
//	workflow.WithCatchTyped(
//	    workflow.CatchHTTPErrors().Or(workflow.CatchGRPCErrors()),
//	    "networkErr",
//	    workflow.SetTask("handleNetworkError", ...),
//	)
type ErrorMatcher struct {
	types []string
}

// Types returns the error type strings for use in CATCH blocks.
// This method is called internally by WithCatchTyped.
func (m *ErrorMatcher) Types() []string {
	return m.types
}

// Or combines this ErrorMatcher with another, creating a matcher that catches either error type.
// This allows composable error matching patterns.
//
// Example:
//
//	// Catch either HTTP or gRPC errors
//	workflow.CatchHTTPErrors().Or(workflow.CatchGRPCErrors())
func (m *ErrorMatcher) Or(other *ErrorMatcher) *ErrorMatcher {
	combined := make([]string, 0, len(m.types)+len(other.types))
	combined = append(combined, m.types...)
	combined = append(combined, other.types...)
	return &ErrorMatcher{types: combined}
}

// =============================================================================
// Platform Error Matchers
// =============================================================================

// CatchHTTPErrors catches all HTTP_CALL task failures.
// This includes 3xx redirects, 4xx client errors, and 5xx server errors.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchHTTPErrors(),
//	    "httpErr",
//	    workflow.SetTask("retryOrFallback", ...),
//	)
func CatchHTTPErrors() *ErrorMatcher {
	return &ErrorMatcher{types: []string{ErrorTypeHTTPCall}}
}

// CatchGRPCErrors catches all GRPC_CALL task failures.
// This includes proto loading errors, serialization errors, and gRPC call failures.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchGRPCErrors(),
//	    "grpcErr",
//	    workflow.SetTask("handleGRPCFailure", ...),
//	)
func CatchGRPCErrors() *ErrorMatcher {
	return &ErrorMatcher{types: []string{ErrorTypeGRPCCall}}
}

// CatchValidationErrors catches workflow input validation failures.
// This occurs before workflow execution when input doesn't match the schema.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchValidationErrors(),
//	    "validationErr",
//	    workflow.SetTask("logValidationFailure", ...),
//	)
func CatchValidationErrors() *ErrorMatcher {
	return &ErrorMatcher{types: []string{ErrorTypeValidation}}
}

// CatchConditionErrors catches if/when conditional evaluation failures.
// This occurs when SWITCH conditions or task guards fail to evaluate.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchConditionErrors(),
//	    "conditionErr",
//	    workflow.SetTask("handleInvalidExpression", ...),
//	)
func CatchConditionErrors() *ErrorMatcher {
	return &ErrorMatcher{types: []string{ErrorTypeIfStatement}}
}

// CatchCommandErrors catches RUN task (shell command) failures.
// This occurs when a shell command exits with a non-zero status code.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchCommandErrors(),
//	    "cmdErr",
//	    workflow.SetTask("handleScriptFailure", ...),
//	)
func CatchCommandErrors() *ErrorMatcher {
	return &ErrorMatcher{types: []string{ErrorTypeCommand}}
}

// CatchNetworkErrors catches all network-related errors (HTTP + gRPC).
// This is a convenience function that combines HTTP and gRPC error matchers.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchNetworkErrors(),
//	    "networkErr",
//	    workflow.SetTask("handleNetworkFailure", ...),
//	)
func CatchNetworkErrors() *ErrorMatcher {
	return &ErrorMatcher{types: []string{ErrorTypeHTTPCall, ErrorTypeGRPCCall}}
}

// CatchAny catches ALL error types (wildcard "*").
// Use this as a fallback to handle any unhandled errors.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchAny(),
//	    "err",
//	    workflow.SetTask("logUnexpectedError", ...),
//	)
func CatchAny() *ErrorMatcher {
	return &ErrorMatcher{types: []string{ErrorTypeAny}}
}

// =============================================================================
// Custom Error Matchers
// =============================================================================

// CatchCustom catches a user-defined error type.
// Use this for custom errors raised by RAISE tasks in your workflow.
//
// Example:
//
//	// Raise a custom error
//	workflow.RaiseTask("checkInventory",
//	    workflow.WithError("InsufficientInventory"),
//	    workflow.WithMessage("Not enough items"),
//	)
//
//	// Catch the custom error
//	workflow.WithCatchTyped(
//	    workflow.CatchCustom("InsufficientInventory"),
//	    "inventoryErr",
//	    workflow.SetTask("handleShortage", ...),
//	)
func CatchCustom(errorType string) *ErrorMatcher {
	return &ErrorMatcher{types: []string{errorType}}
}

// CatchMultiple catches multiple specific error types.
// Use this when you want to handle several error types the same way.
//
// Example:
//
//	workflow.WithCatchTyped(
//	    workflow.CatchMultiple("PaymentDeclined", "InsufficientFunds", "CardExpired"),
//	    "paymentErr",
//	    workflow.SetTask("handlePaymentFailure", ...),
//	)
func CatchMultiple(errorTypes ...string) *ErrorMatcher {
	return &ErrorMatcher{types: errorTypes}
}
