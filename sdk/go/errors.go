package stigmer

import "github.com/stigmer/stigmer/sdk/go/v3/internal/gen"

// Error is the structured error type returned by all SDK operations.
type Error = gen.Error

// ErrorCode represents a category of SDK error, mapped from gRPC status codes.
type ErrorCode = gen.ErrorCode

const (
	CodeUnknown            = gen.CodeUnknown
	CodeNotFound           = gen.CodeNotFound
	CodePermissionDenied   = gen.CodePermissionDenied
	CodeUnauthenticated    = gen.CodeUnauthenticated
	CodeInvalidArgument    = gen.CodeInvalidArgument
	CodeAlreadyExists      = gen.CodeAlreadyExists
	CodeResourceExhausted  = gen.CodeResourceExhausted
	CodeFailedPrecondition = gen.CodeFailedPrecondition
	CodeInternal           = gen.CodeInternal
	CodeUnavailable        = gen.CodeUnavailable
)

// IsNotFound reports whether the error is a not-found error.
func IsNotFound(err error) bool { return gen.IsNotFound(err) }

// IsUnauthenticated reports whether the error is an authentication error.
func IsUnauthenticated(err error) bool { return gen.IsUnauthenticated(err) }

// IsPermissionDenied reports whether the error is a permission denied error.
func IsPermissionDenied(err error) bool { return gen.IsPermissionDenied(err) }
