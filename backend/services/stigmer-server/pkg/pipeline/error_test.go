package pipeline

import (
	"errors"
	"testing"
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
