package workflow

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

// Platform Error Matchers
//
// These functions create ErrorMatchers for platform-generated error types.
// They provide type-safe, discoverable ways to catch errors from the Stigmer runtime.

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

// Custom Error Matchers
//
// For user-defined error types raised by RAISE tasks.

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

// WithCatchTyped adds a type-safe error handler using ErrorMatcher.
// This is an alternative to WithCatch that provides better UX with error matchers.
//
// Example:
//
//	workflow.TryTask("attemptOperation",
//	    workflow.WithTry(/* ... */),
//	    workflow.WithCatchTyped(
//	        workflow.CatchHTTPErrors(),  // Type-safe!
//	        "httpErr",
//	        workflow.SetTask("handleHTTPError", ...),
//	    ),
//	    workflow.WithCatchTyped(
//	        workflow.CatchAny(),  // Catch-all fallback
//	        "err",
//	        workflow.SetTask("handleUnknownError", ...),
//	    ),
//	)
func WithCatchTyped(matcher *ErrorMatcher, as string, tasks ...*Task) TryTaskOption {
	return WithCatch(matcher.Types(), as, tasks...)
}
