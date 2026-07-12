package pipeline

import (
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPipelineError(t *testing.T) {
	originalErr := errors.New("original error")
	pipelineErr := &PipelineError{
		StepName: "TestStep",
		Err:      originalErr,
	}

	expected := "pipeline step TestStep failed: original error"
	if pipelineErr.Error() != expected {
		t.Errorf("expected error message '%s', got '%s'", expected, pipelineErr.Error())
	}
}

func TestPipelineErrorUnwrap(t *testing.T) {
	originalErr := errors.New("original error")
	pipelineErr := &PipelineError{
		StepName: "TestStep",
		Err:      originalErr,
	}

	unwrapped := errors.Unwrap(pipelineErr)
	if unwrapped != originalErr {
		t.Error("Unwrap should return the original error")
	}

	// Test with errors.Is
	if !errors.Is(pipelineErr, originalErr) {
		t.Error("errors.Is should work with PipelineError")
	}
}

func TestStepError(t *testing.T) {
	originalErr := errors.New("test error")
	err := StepError("MyStep", originalErr)

	var pipelineErr *PipelineError
	if !errors.As(err, &pipelineErr) {
		t.Error("StepError should return a PipelineError")
	}

	if pipelineErr.StepName != "MyStep" {
		t.Errorf("expected step name 'MyStep', got '%s'", pipelineErr.StepName)
	}

	if !errors.Is(err, originalErr) {
		t.Error("wrapped error should be unwrappable")
	}
}

func TestStepErrorWithNil(t *testing.T) {
	err := StepError("MyStep", nil)
	if err != nil {
		t.Error("StepError with nil error should return nil")
	}
}

// TestPipelineError_GRPCStatus locks the invariant that regressed in #198: the
// pipeline wrapper must preserve a step's typed gRPC status all the way to the
// transport, and must never leak a plain error as codes.Unknown. A step that
// returns a typed status keeps its code; a step that returns a naked error is
// surfaced as codes.Internal (the correct code for a should-never-happen
// server-side failure), not Unknown (gRPC's "no status" sentinel).
func TestPipelineError_GRPCStatus(t *testing.T) {
	tests := []struct {
		name     string
		inner    error
		wantCode codes.Code
	}{
		{
			name:     "AlreadyExists preserved",
			inner:    status.Error(codes.AlreadyExists, "Workflow already exists: slug 'x'"),
			wantCode: codes.AlreadyExists,
		},
		{
			name:     "InvalidArgument preserved",
			inner:    status.Error(codes.InvalidArgument, "resource name is required"),
			wantCode: codes.InvalidArgument,
		},
		{
			name:     "FailedPrecondition preserved",
			inner:    status.Error(codes.FailedPrecondition, "referenced MCP server not found"),
			wantCode: codes.FailedPrecondition,
		},
		{
			name:     "NotFound preserved",
			inner:    status.Error(codes.NotFound, "Workflow not found"),
			wantCode: codes.NotFound,
		},
		{
			name:     "naked error maps to Internal, not Unknown",
			inner:    errors.New("resource metadata is nil"),
			wantCode: codes.Internal,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wrapped := StepError("SomeStep", tt.inner)

			// status.FromError is exactly what the gRPC transport calls when the
			// handler returns this error, so this asserts the on-the-wire code.
			if got := status.Code(wrapped); got != tt.wantCode {
				t.Errorf("status.Code(wrapped) = %s, want %s", got, tt.wantCode)
			}
			if got := status.Code(wrapped); got == codes.Unknown {
				t.Error("wrapped pipeline error must never surface as codes.Unknown")
			}
		})
	}
}

// TestPipelineError_GRPCStatus_TypedMessageIsClean verifies that a typed step
// error reaches the client with the domain message only, without the internal
// "pipeline step X failed:" prefix (which stays in Error() for server logs).
func TestPipelineError_GRPCStatus_TypedMessageIsClean(t *testing.T) {
	inner := status.Error(codes.AlreadyExists, "Workflow already exists: slug 'x'")
	wrapped := StepError("CheckDuplicate", inner)

	st, ok := status.FromError(wrapped)
	if !ok {
		t.Fatal("expected a gRPC status from the wrapped error")
	}
	if st.Message() != "Workflow already exists: slug 'x'" {
		t.Errorf("client message = %q, want the clean domain message without the step prefix", st.Message())
	}

	// The step context is still available for debugging via Error().
	var pe *PipelineError
	if !errors.As(wrapped, &pe) {
		t.Fatal("expected a *PipelineError")
	}
	if pe.Error() != "pipeline step CheckDuplicate failed: rpc error: code = AlreadyExists desc = Workflow already exists: slug 'x'" {
		t.Errorf("Error() = %q, want the step-prefixed form for server logs", pe.Error())
	}
}

func TestValidationError(t *testing.T) {
	err := ValidationError("ValidateStep", "field is required")

	var pipelineErr *PipelineError
	if !errors.As(err, &pipelineErr) {
		t.Error("ValidationError should return a PipelineError")
	}

	if pipelineErr.StepName != "ValidateStep" {
		t.Errorf("expected step name 'ValidateStep', got '%s'", pipelineErr.StepName)
	}

	expectedMsg := "pipeline step ValidateStep failed: validation error: field is required"
	if err.Error() != expectedMsg {
		t.Errorf("expected error message '%s', got '%s'", expectedMsg, err.Error())
	}
}
