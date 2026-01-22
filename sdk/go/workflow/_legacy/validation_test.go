package workflow_test

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func TestWorkflow_TaskNameValidation(t *testing.T) {
	tests := []struct {
		name     string
		taskName string
		wantErr  bool
	}{
		{
			name:     "valid task name with alphanumeric",
			taskName: "task123",
			wantErr:  false,
		},
		{
			name:     "valid task name with hyphens",
			taskName: "my-task-name",
			wantErr:  false,
		},
		{
			name:     "valid task name with underscores",
			taskName: "my_task_name",
			wantErr:  false,
		},
		{
			name:     "valid task name mixed",
			taskName: "my_task-123",
			wantErr:  false,
		},
		{
			name:     "empty task name",
			taskName: "",
			wantErr:  true,
		},
		{
			name:     "task name with spaces",
			taskName: "my task",
			wantErr:  true,
		},
		{
			name:     "task name with special characters",
			taskName: "my@task",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := workflow.New(
				nil, // No context needed for tests
				workflow.WithNamespace("test"),
				workflow.WithName("test"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(workflow.SetTask(tt.taskName, workflow.SetVar("x", "1"))),
			)
			if (err != nil) != tt.wantErr {
				t.Errorf("Task name validation error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestWorkflow_TaskConfigValidation_SetTask(t *testing.T) {
	// SET task with no variables should fail
	_, err := workflow.New(
		nil, // No context needed for tests
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("empty")), // No variables
	)

	if err == nil {
		t.Error("Expected error for SET task with no variables, got nil")
	}
}

func TestWorkflow_TaskConfigValidation_HttpCallTask(t *testing.T) {
	tests := []struct {
		name    string
		task    *workflow.Task
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid HTTP_CALL task",
			task: workflow.HttpCallTask("fetch",
				workflow.WithMethod("GET"),
				workflow.WithURI("https://api.example.com/data"),
			),
			wantErr: false,
		},
		{
			name:    "HTTP_CALL task with missing method",
			task:    workflow.HttpCallTask("fetch", workflow.WithURI("https://api.example.com/data")),
			wantErr: true,
			errMsg:  "HTTP_CALL task must have a method",
		},
		{
			name:    "HTTP_CALL task with missing URI",
			task:    workflow.HttpCallTask("fetch", workflow.WithMethod("GET")),
			wantErr: true,
			errMsg:  "HTTP_CALL task must have a URI",
		},
		{
			name: "HTTP_CALL task with invalid method",
			task: workflow.HttpCallTask("fetch",
				workflow.WithMethod("INVALID"),
				workflow.WithURI("https://api.example.com/data"),
			),
			wantErr: true,
			errMsg:  "HTTP method must be one of: GET, POST, PUT, DELETE, PATCH",
		},
		{
			name: "HTTP_CALL task with invalid timeout (negative)",
			task: workflow.HttpCallTask("fetch",
				workflow.WithMethod("GET"),
				workflow.WithURI("https://api.example.com/data"),
				workflow.WithTimeout(-1),
			),
			wantErr: true,
			errMsg:  "timeout must be between 0 and 300 seconds",
		},
		{
			name: "HTTP_CALL task with invalid timeout (too large)",
			task: workflow.HttpCallTask("fetch",
				workflow.WithMethod("GET"),
				workflow.WithURI("https://api.example.com/data"),
				workflow.WithTimeout(400),
			),
			wantErr: true,
			errMsg:  "timeout must be between 0 and 300 seconds",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := workflow.New(
				nil, // No context needed for tests
				workflow.WithNamespace("test"),
				workflow.WithName("test"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(tt.task),
			)
			if (err != nil) != tt.wantErr {
				t.Errorf("HTTP_CALL validation error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr && err != nil {
				if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("HTTP_CALL validation error message = %v, want to contain %v", err.Error(), tt.errMsg)
				}
			}
		})
	}
}

func TestWorkflow_TaskConfigValidation_GrpcCallTask(t *testing.T) {
	tests := []struct {
		name    string
		task    *workflow.Task
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid GRPC_CALL task",
			task: workflow.GrpcCallTask("call",
				workflow.WithService("UserService"),
				workflow.WithGrpcMethod("GetUser"),
			),
			wantErr: false,
		},
		{
			name: "GRPC_CALL task with missing service",
			task: workflow.GrpcCallTask("call",
				workflow.WithGrpcMethod("GetUser"),
			),
			wantErr: true,
			errMsg:  "GRPC_CALL task must have a service",
		},
		{
			name: "GRPC_CALL task with missing method",
			task: workflow.GrpcCallTask("call",
				workflow.WithService("UserService"),
			),
			wantErr: true,
			errMsg:  "GRPC_CALL task must have a method",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := workflow.New(
				nil, // No context needed for tests
				workflow.WithNamespace("test"),
				workflow.WithName("test"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(tt.task),
			)
			if (err != nil) != tt.wantErr {
				t.Errorf("GRPC_CALL validation error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr && err != nil {
				if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("GRPC_CALL validation error message = %v, want to contain %v", err.Error(), tt.errMsg)
				}
			}
		})
	}
}

func TestWorkflow_TaskConfigValidation_SwitchTask(t *testing.T) {
	// SWITCH task with no cases should fail
	_, err := workflow.New(
		nil, // No context needed for tests
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SwitchTask("switch")), // No cases
	)

	if err == nil {
		t.Error("Expected error for SWITCH task with no cases, got nil")
	}
}

func TestWorkflow_TaskConfigValidation_ForTask(t *testing.T) {
	tests := []struct {
		name    string
		task    *workflow.Task
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid FOR task",
			task: workflow.ForTask("loop",
				workflow.WithIn("${.items}"),
				workflow.WithDo(workflow.SetTask("process", workflow.SetVar("item", "${.}"))),
			),
			wantErr: false,
		},
		{
			name: "FOR task with missing 'in'",
			task: workflow.ForTask("loop",
				workflow.WithDo(workflow.SetTask("process", workflow.SetVar("item", "${.}"))),
			),
			wantErr: true,
			errMsg:  "FOR task must have an 'in' expression",
		},
		{
			name: "FOR task with no tasks in 'do'",
			task: workflow.ForTask("loop",
				workflow.WithIn("${.items}"),
			),
			wantErr: true,
			errMsg:  "FOR task must have at least one task in 'do' block",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := workflow.New(
				nil, // No context needed for tests
				workflow.WithNamespace("test"),
				workflow.WithName("test"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(tt.task),
			)
			if (err != nil) != tt.wantErr {
				t.Errorf("FOR validation error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr && err != nil {
				if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("FOR validation error message = %v, want to contain %v", err.Error(), tt.errMsg)
				}
			}
		})
	}
}

func TestWorkflow_TaskConfigValidation_OtherTasks(t *testing.T) {
	tests := []struct {
		name    string
		task    *workflow.Task
		wantErr bool
	}{
		{
			name: "valid FORK task",
			task: workflow.ForkTask("parallel",
				workflow.WithBranch("branch1", workflow.SetTask("task1", workflow.SetVar("x", "1"))),
			),
			wantErr: false,
		},
		{
			name:    "invalid FORK task (no branches)",
			task:    workflow.ForkTask("parallel"),
			wantErr: true,
		},
		{
			name: "valid TRY task",
			task: workflow.TryTask("try",
				workflow.WithTry(workflow.SetTask("risky", workflow.SetVar("x", "1"))),
			),
			wantErr: false,
		},
		{
			name:    "invalid TRY task (no tasks)",
			task:    workflow.TryTask("try"),
			wantErr: true,
		},
		{
			name: "valid LISTEN task",
			task: workflow.ListenTask("wait",
				workflow.WithEvent("approval.granted"),
			),
			wantErr: false,
		},
		{
			name:    "invalid LISTEN task (no event)",
			task:    workflow.ListenTask("wait"),
			wantErr: true,
		},
		{
			name: "valid WAIT task",
			task: workflow.WaitTask("delay",
				workflow.WithDuration("5s"),
			),
			wantErr: false,
		},
		{
			name:    "invalid WAIT task (no duration)",
			task:    workflow.WaitTask("delay"),
			wantErr: true,
		},
		{
			name: "valid CALL_ACTIVITY task",
			task: workflow.CallActivityTask("process",
				workflow.WithActivity("DataProcessor"),
			),
			wantErr: false,
		},
		{
			name:    "invalid CALL_ACTIVITY task (no activity)",
			task:    workflow.CallActivityTask("process"),
			wantErr: true,
		},
		{
			name: "valid RAISE task",
			task: workflow.RaiseTask("error",
				workflow.WithError("ValidationError"),
			),
			wantErr: false,
		},
		{
			name:    "invalid RAISE task (no error)",
			task:    workflow.RaiseTask("error"),
			wantErr: true,
		},
		{
			name: "valid RUN task",
			task: workflow.RunTask("sub",
				workflow.WithWorkflow("sub-workflow"),
			),
			wantErr: false,
		},
		{
			name:    "invalid RUN task (no workflow)",
			task:    workflow.RunTask("sub"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := workflow.New(
				nil, // No context needed for tests
				workflow.WithNamespace("test"),
				workflow.WithName("test"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(tt.task),
			)
			if (err != nil) != tt.wantErr {
				t.Errorf("%s validation error = %v, wantErr %v", tt.name, err, tt.wantErr)
			}
		})
	}
}
