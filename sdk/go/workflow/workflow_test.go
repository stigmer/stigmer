package workflow_test

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func TestWorkflow_New(t *testing.T) {
	tests := []struct {
		name    string
		opts    []workflow.Option
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid workflow with all required fields",
			opts: []workflow.Option{
				workflow.WithNamespace("test-namespace"),
				workflow.WithName("test-workflow"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: false,
		},
		{
			name: "valid workflow with description",
			opts: []workflow.Option{
				workflow.WithNamespace("test-namespace"),
				workflow.WithName("test-workflow"),
				workflow.WithVersion("1.0.0"),
				workflow.WithDescription("Test workflow description"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: false,
		},
		{
			name: "missing namespace",
			opts: []workflow.Option{
				workflow.WithName("test-workflow"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: true,
			errMsg:  "namespace is required",
		},
		{
			name: "missing name",
			opts: []workflow.Option{
				workflow.WithNamespace("test-namespace"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: true,
			errMsg:  "name is required",
		},
		{
			name: "missing version (defaults to 0.1.0)",
			opts: []workflow.Option{
				workflow.WithNamespace("test-namespace"),
				workflow.WithName("test-workflow"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: false, // Version is now optional, defaults to "0.1.0"
		},
		{
			name: "invalid version (not semver)",
			opts: []workflow.Option{
				workflow.WithNamespace("test-namespace"),
				workflow.WithName("test-workflow"),
				workflow.WithVersion("invalid"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: true,
			errMsg:  "version must be valid semver",
		},
		{
			name: "no tasks (allowed for Pulumi-style pattern)",
			opts: []workflow.Option{
				workflow.WithNamespace("test-namespace"),
				workflow.WithName("test-workflow"),
				workflow.WithVersion("1.0.0"),
			},
			wantErr: false, // Changed: now allowed to support wf.HttpGet() pattern
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := workflow.New(tt.opts...)
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr && err != nil {
				// Check if error message contains expected message
				if !containsMessage(err.Error(), tt.errMsg) {
					t.Errorf("New() error message = %v, want to contain %v", err.Error(), tt.errMsg)
				}
			}
			if !tt.wantErr && wf == nil {
				t.Error("New() returned nil workflow without error")
			}
		})
	}
}

func TestWorkflow_DefaultVersion(t *testing.T) {
	// Test that version defaults to "0.1.0" when not provided
	wf, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test-workflow"),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetInt("x", 1))),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow: %v", err)
	}

	expectedVersion := "0.1.0"
	if wf.Document.Version != expectedVersion {
		t.Errorf("Default version = %q, want %q", wf.Document.Version, expectedVersion)
	}
}

func TestWorkflow_AddTask(t *testing.T) {
	wf, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetVar("x", "1"))),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow: %v", err)
	}

	initialTaskCount := len(wf.Tasks)

	// Add task using builder method
	wf.AddTask(workflow.SetTask("task2", workflow.SetVar("y", "2")))

	if len(wf.Tasks) != initialTaskCount+1 {
		t.Errorf("AddTask() did not add task, got %d tasks, want %d", len(wf.Tasks), initialTaskCount+1)
	}

	if wf.Tasks[1].Name != "task2" {
		t.Errorf("AddTask() added wrong task, got name %q, want %q", wf.Tasks[1].Name, "task2")
	}
}

func TestWorkflow_AddTasks(t *testing.T) {
	wf, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetVar("x", "1"))),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow: %v", err)
	}

	initialTaskCount := len(wf.Tasks)

	// Add multiple tasks using builder method
	wf.AddTasks(
		workflow.SetTask("task2", workflow.SetVar("y", "2")),
		workflow.SetTask("task3", workflow.SetVar("z", "3")),
	)

	if len(wf.Tasks) != initialTaskCount+2 {
		t.Errorf("AddTasks() did not add tasks, got %d tasks, want %d", len(wf.Tasks), initialTaskCount+2)
	}
}

func TestWorkflow_AddEnvironmentVariable(t *testing.T) {
	wf, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetVar("x", "1"))),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow: %v", err)
	}

	envVar, err := environment.New(
		environment.WithName("API_TOKEN"),
		environment.WithSecret(true),
	)
	if err != nil {
		t.Fatalf("Failed to create environment variable: %v", err)
	}

	wf.AddEnvironmentVariable(envVar)

	if len(wf.EnvironmentVariables) != 1 {
		t.Errorf("AddEnvironmentVariable() did not add variable, got %d variables, want 1", len(wf.EnvironmentVariables))
	}

	if wf.EnvironmentVariables[0].Name != "API_TOKEN" {
		t.Errorf("AddEnvironmentVariable() added wrong variable, got name %q, want %q", wf.EnvironmentVariables[0].Name, "API_TOKEN")
	}
}

func TestWorkflow_String(t *testing.T) {
	wf, err := workflow.New(
		workflow.WithNamespace("test-ns"),
		workflow.WithName("test-wf"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetVar("x", "1"))),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow: %v", err)
	}

	got := wf.String()
	want := "Workflow(namespace=test-ns, name=test-wf, version=1.0.0)"

	if got != want {
		t.Errorf("String() = %q, want %q", got, want)
	}
}

func TestWorkflow_DuplicateTaskNames(t *testing.T) {
	_, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetVar("x", "1"))),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetVar("y", "2"))), // Duplicate name
	)

	if err == nil {
		t.Error("New() did not return error for duplicate task names")
	}

	if err != nil && err.Error()[:len("validation failed")] != "validation failed" {
		t.Errorf("New() error = %v, want validation error for duplicate task names", err)
	}
}

func TestWorkflow_WithOrg(t *testing.T) {
	wf, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithOrg("my-org"),
		workflow.WithTask(workflow.SetTask("task1", workflow.SetVar("x", "1"))),
	)
	if err != nil {
		t.Fatalf("Failed to create workflow: %v", err)
	}

	if wf.Org != "my-org" {
		t.Errorf("WithOrg() set org = %q, want %q", wf.Org, "my-org")
	}
}

// containsMessage checks if error message contains the expected message
func containsMessage(errMsg, expected string) bool {
	return strings.Contains(errMsg, expected)
}
