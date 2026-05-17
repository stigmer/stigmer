package harness

import (
	"context"
	"fmt"
	"log/slog"
	"testing"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	defaultPollInterval = 250 * time.Millisecond
	defaultMaxInterval  = 2 * time.Second
	defaultTimeout      = 60 * time.Second
	backoffFactor       = 1.5
)

// ExecutionWaiter polls workflow execution status until a condition is met.
type ExecutionWaiter struct {
	client workflowexecutionv1.WorkflowExecutionQueryControllerClient
	logger *slog.Logger
}

// NewExecutionWaiter creates a waiter using the given query client.
func NewExecutionWaiter(client workflowexecutionv1.WorkflowExecutionQueryControllerClient, logger *slog.Logger) *ExecutionWaiter {
	if logger == nil {
		logger = slog.Default()
	}
	return &ExecutionWaiter{client: client, logger: logger}
}

// WaitForPhase polls until the execution reaches the specified phase or times out.
func (w *ExecutionWaiter) WaitForPhase(ctx context.Context, executionID string, target workflowexecutionv1.ExecutionPhase, timeout time.Duration) (*workflowexecutionv1.WorkflowExecution, error) {
	if timeout == 0 {
		timeout = defaultTimeout
	}

	deadline := time.Now().Add(timeout)
	interval := defaultPollInterval

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		exec, err := w.client.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
		if err != nil {
			w.logger.Debug("poll error (will retry)", "execution_id", executionID, "error", err)
			time.Sleep(interval)
			interval = nextInterval(interval)
			continue
		}

		currentPhase := exec.GetStatus().GetPhase()
		if currentPhase == target {
			return exec, nil
		}

		if isTerminalPhase(currentPhase) && currentPhase != target {
			return exec, fmt.Errorf("execution reached terminal phase %s instead of expected %s",
				currentPhase.String(), target.String())
		}

		time.Sleep(interval)
		interval = nextInterval(interval)
	}

	return nil, fmt.Errorf("timed out waiting for execution %s to reach phase %s after %v",
		executionID, target.String(), timeout)
}

// WaitForTerminal polls until the execution reaches any terminal phase.
func (w *ExecutionWaiter) WaitForTerminal(ctx context.Context, executionID string, timeout time.Duration) (*workflowexecutionv1.WorkflowExecution, error) {
	ctx, span := Tracer().Start(ctx, "stigmer.wait",
		trace.WithAttributes(
			attribute.String("execution.id", executionID),
			attribute.String("wait.type", "terminal"),
		),
	)
	defer span.End()

	if timeout == 0 {
		timeout = defaultTimeout
	}

	deadline := time.Now().Add(timeout)
	interval := defaultPollInterval

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			span.SetStatus(codes.Error, "context cancelled")
			return nil, ctx.Err()
		default:
		}

		exec, err := w.client.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
		if err != nil {
			w.logger.Debug("poll error (will retry)", "execution_id", executionID, "error", err)
			time.Sleep(interval)
			interval = nextInterval(interval)
			continue
		}

		phase := exec.GetStatus().GetPhase()
		if isTerminalPhase(phase) {
			span.SetAttributes(
				attribute.String("execution.phase", phase.String()),
				attribute.Int("execution.task_count", len(exec.GetStatus().GetTasks())),
			)
			return exec, nil
		}

		w.logger.Debug("execution still running",
			"execution_id", executionID,
			"phase", phase.String(),
			"tasks", len(exec.GetStatus().GetTasks()),
		)

		time.Sleep(interval)
		interval = nextInterval(interval)
	}

	span.SetStatus(codes.Error, "timeout")
	return nil, fmt.Errorf("timed out waiting for execution %s to reach terminal phase after %v",
		executionID, timeout)
}

// AssertTaskStatus finds a task by name and asserts its status.
func AssertTaskStatus(t *testing.T, exec *workflowexecutionv1.WorkflowExecution, taskName string, expected workflowexecutionv1.WorkflowTaskStatus) {
	t.Helper()
	task := findTask(exec, taskName)
	if !assert.NotNilf(t, task, "task %q not found in execution status", taskName) {
		return
	}
	assert.Equal(t, expected, task.GetStatus(),
		"task %q: expected status %s, got %s", taskName, expected.String(), task.GetStatus().String())
}

// AssertExecutionOutput asserts that the execution output contains a specific key with the expected string value.
func AssertExecutionOutput(t *testing.T, exec *workflowexecutionv1.WorkflowExecution, key string, expectedValue string) {
	t.Helper()
	output := exec.GetStatus().GetOutput()
	if !assert.NotNil(t, output, "execution output is nil") {
		return
	}

	fields := output.GetFields()
	if !assert.Contains(t, fields, key, "output missing key %q", key) {
		return
	}

	actual := fields[key]
	assert.Equal(t, expectedValue, valueToString(actual),
		"output[%q]: expected %q, got %q", key, expectedValue, valueToString(actual))
}

// AssertPhase asserts the execution is in the expected phase.
func AssertPhase(t *testing.T, exec *workflowexecutionv1.WorkflowExecution, expected workflowexecutionv1.ExecutionPhase) {
	t.Helper()
	assert.Equal(t, expected, exec.GetStatus().GetPhase(),
		"expected phase %s, got %s", expected.String(), exec.GetStatus().GetPhase().String())
}

// AssertAllTaskStatuses asserts multiple task statuses in a single call.
// Useful for multi-step workflows where you want to verify the status of every task.
func AssertAllTaskStatuses(t *testing.T, exec *workflowexecutionv1.WorkflowExecution, expected map[string]workflowexecutionv1.WorkflowTaskStatus) {
	t.Helper()
	for taskName, expectedStatus := range expected {
		AssertTaskStatus(t, exec, taskName, expectedStatus)
	}
}

func isTerminalPhase(phase workflowexecutionv1.ExecutionPhase) bool {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return true
	default:
		return false
	}
}

func findTask(exec *workflowexecutionv1.WorkflowExecution, name string) *workflowexecutionv1.WorkflowTask {
	for _, task := range exec.GetStatus().GetTasks() {
		if task.GetTaskName() == name {
			return task
		}
	}
	return nil
}

func nextInterval(current time.Duration) time.Duration {
	next := time.Duration(float64(current) * backoffFactor)
	if next > defaultMaxInterval {
		return defaultMaxInterval
	}
	return next
}

func valueToString(v *structpb.Value) string {
	if v == nil {
		return ""
	}
	switch k := v.GetKind().(type) {
	case *structpb.Value_StringValue:
		return k.StringValue
	case *structpb.Value_NumberValue:
		return fmt.Sprintf("%v", k.NumberValue)
	case *structpb.Value_BoolValue:
		return fmt.Sprintf("%v", k.BoolValue)
	default:
		return fmt.Sprintf("%v", v.GetKind())
	}
}
