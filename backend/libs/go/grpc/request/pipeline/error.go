package pipeline

import (
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// PipelineError wraps errors that occur during step execution.
// It preserves the step name for debugging and troubleshooting.
type PipelineError struct {
	// StepName is the name of the step that failed
	StepName string

	// Err is the underlying error
	Err error
}

// Error implements the error interface.
func (e *PipelineError) Error() string {
	return fmt.Sprintf("pipeline step %s failed: %v", e.StepName, e.Err)
}

// Unwrap returns the underlying error.
// This allows errors.Is and errors.As to work correctly.
func (e *PipelineError) Unwrap() error {
	return e.Err
}

// internalFallbackMessage is the wire description for a step that returned a
// plain (un-statused) error. It is deliberately generic: the real error text
// can carry storage-engine detail, filesystem paths, or other internals, and
// the status description is client-visible — on an anonymous surface that is
// information disclosure (stigmer/stigmer#478). The step name and cause stay
// in Error(), which the transport logging interceptors record server-side.
const internalFallbackMessage = "internal server error"

// GRPCStatus lets the transport recover the step's intended gRPC code. A step
// that returns a typed status (AlreadyExists, InvalidArgument, FailedPrecondition,
// NotFound) has it preserved verbatim; any un-statused error becomes Internal
// rather than Unknown, so the pipeline never leaks gRPC's "no status" sentinel
// for a step that simply returned a plain error.
//
// Implementing GRPCStatus() (not just Unwrap) makes status.FromError hit its
// explicit fast path instead of relying on errors.As chain-walking, so the
// contract does not depend on grpc-go internals. Returning the inner status
// directly also strips the "pipeline step X failed:" prefix from the wire
// message on typed errors, giving clients the clean domain message; the step
// name is still retained in server logs and in Error() for debugging.
//
// The un-statused arm carries only internalFallbackMessage on the wire —
// never e.Error(), whose step name and raw cause are internals a client (and
// on anonymous surfaces, an unauthenticated visitor) must not see. Steps that
// want a meaningful client-visible message for an internal failure return
// grpclib.InternalError(err, "failed to <do thing>"), whose sanitized status
// the typed arm preserves.
func (e *PipelineError) GRPCStatus() *status.Status {
	if st, ok := status.FromError(e.Err); ok {
		return st
	}
	return status.New(codes.Internal, internalFallbackMessage)
}

// StepError creates a new PipelineError wrapping the given error.
func StepError(stepName string, err error) error {
	if err == nil {
		return nil
	}
	return &PipelineError{
		StepName: stepName,
		Err:      err,
	}
}

// ValidationError creates a pipeline error for validation failures.
func ValidationError(stepName string, msg string) error {
	return &PipelineError{
		StepName: stepName,
		Err:      fmt.Errorf("validation error: %s", msg),
	}
}
