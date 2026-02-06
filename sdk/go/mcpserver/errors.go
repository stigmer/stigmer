package mcpserver

import (
	"errors"

	"github.com/stigmer/stigmer/sdk/go/internal/validation"
)

// Common errors that can occur when working with MCP servers.
var (
	// ErrNameRequired is returned when an MCP server name is not provided.
	ErrNameRequired = errors.New("mcpserver: name is required")

	// ErrStdioRequired is returned when Stdio configuration is missing for a Stdio server.
	ErrStdioRequired = errors.New("mcpserver: Stdio configuration is required for Stdio server")

	// ErrHttpRequired is returned when Http configuration is missing for an HTTP server.
	ErrHttpRequired = errors.New("mcpserver: Http configuration is required for HTTP server")

	// ErrCommandRequired is returned when Stdio.Command is not provided.
	ErrCommandRequired = errors.New("mcpserver: Stdio.Command is required")

	// ErrUrlRequired is returned when Http.Url is not provided.
	ErrUrlRequired = errors.New("mcpserver: Http.Url is required")

	// ErrArgsNil is returned when Args is nil during proto conversion.
	ErrArgsNil = errors.New("mcpserver: Args is nil, cannot convert to proto")

	// ErrConversion is returned when proto conversion fails.
	ErrConversion = errors.New("mcpserver: proto conversion failed")
)

// ValidationError is an alias to the shared validation error type.
// This maintains backward compatibility with existing code that uses mcpserver.ValidationError.
type ValidationError = validation.ValidationError

// ConversionError is an alias to the shared conversion error type.
// This maintains backward compatibility with existing code that uses mcpserver.ConversionError.
type ConversionError = validation.ConversionError

// =============================================================================
// Resource Errors
// =============================================================================

// ResourceError is an alias to the shared resource error type.
// This provides context about which MCP server failed and during what operation.
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

// NewResourceError creates a new resource error for an MCP server.
// This is a convenience wrapper that pre-fills ResourceType as "MCPServer".
//
// Example:
//
//	err := mcpserver.NewResourceError("github-mcp", "validation", "missing command")
func NewResourceError(name, operation, message string) *ResourceError {
	return validation.NewResourceError("MCPServer", name, operation, message)
}

// NewResourceErrorWithCause creates a new resource error for an MCP server with a cause.
// This is a convenience wrapper that pre-fills ResourceType as "MCPServer".
//
// Example:
//
//	err := mcpserver.NewResourceErrorWithCause("github-mcp", "validation", "name is required", ErrNameRequired)
func NewResourceErrorWithCause(name, operation, message string, err error) *ResourceError {
	return validation.NewResourceErrorWithCause("MCPServer", name, operation, message, err)
}
