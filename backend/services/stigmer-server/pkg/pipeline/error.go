package pipeline

import "fmt"

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
