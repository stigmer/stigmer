package workflow_test

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func TestWorkflow_DocumentValidation(t *testing.T) {
	tests := []struct {
		name    string
		opts    []workflow.Option
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid document",
			opts: []workflow.Option{
				workflow.WithNamespace("my-namespace"),
				workflow.WithName("my-workflow"),
				workflow.WithVersion("1.0.0"),
				workflow.WithDescription("My workflow description"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: false,
		},
		{
			name: "valid document with pre-release version",
			opts: []workflow.Option{
				workflow.WithNamespace("my-namespace"),
				workflow.WithName("my-workflow"),
				workflow.WithVersion("1.0.0-alpha.1"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: false,
		},
		{
			name: "valid document with build metadata",
			opts: []workflow.Option{
				workflow.WithNamespace("my-namespace"),
				workflow.WithName("my-workflow"),
				workflow.WithVersion("1.0.0+build.123"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: false,
		},
		{
			name: "empty namespace",
			opts: []workflow.Option{
				workflow.WithNamespace(""),
				workflow.WithName("my-workflow"),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: true,
			errMsg:  "namespace is required",
		},
		{
			name: "empty name",
			opts: []workflow.Option{
				workflow.WithNamespace("my-namespace"),
				workflow.WithName(""),
				workflow.WithVersion("1.0.0"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: true,
			errMsg:  "name is required",
		},
		{
			name: "empty version (defaults to 0.1.0)",
			opts: []workflow.Option{
				workflow.WithNamespace("my-namespace"),
				workflow.WithName("my-workflow"),
				workflow.WithVersion(""),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: false, // Empty version is now valid, defaults to "0.1.0"
		},
		{
			name: "invalid version format",
			opts: []workflow.Option{
				workflow.WithNamespace("my-namespace"),
				workflow.WithName("my-workflow"),
				workflow.WithVersion("not-semver"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: true,
			errMsg:  "version must be valid semver",
		},
		{
			name: "invalid version format (missing patch)",
			opts: []workflow.Option{
				workflow.WithNamespace("my-namespace"),
				workflow.WithName("my-workflow"),
				workflow.WithVersion("1.0"),
				workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
			},
			wantErr: true,
			errMsg:  "version must be valid semver",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := workflow.New(tt.opts...)
			if (err != nil) != tt.wantErr {
				t.Errorf("Document validation error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr && err != nil {
				// Check if error message contains expected message
				if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("Document validation error message = %v, want to contain %v", err.Error(), tt.errMsg)
				}
			}
		})
	}
}

func TestWorkflow_DescriptionLength(t *testing.T) {
	longDescription := string(make([]byte, 600)) // > 500 chars

	_, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test"),
		workflow.WithVersion("1.0.0"),
		workflow.WithDescription(longDescription),
		workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
	)

	if err == nil {
		t.Error("Expected error for description > 500 characters, got nil")
	}

	if err != nil && err.Error()[:len("validation failed")] != "validation failed" {
		t.Errorf("Error message = %v, want validation error for description length", err)
	}
}
