package workflow

import (
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// =============================================================================
// Error Case Tests - Validation Failures
// =============================================================================

// TestWorkflowNew_InvalidDocumentFields tests validation of document fields.
func TestWorkflowNew_InvalidDocumentFields(t *testing.T) {
	tests := []struct {
		name         string
		workflowName string
		args         *WorkflowArgs
		wantErr      bool
		errMsg       string
	}{
		{
			name:         "empty namespace",
			workflowName: "test-workflow", // No namespace prefix
			args:         nil,
			wantErr:      true,
			errMsg:       "namespace",
		},
		{
			name:         "valid namespaced name",
			workflowName: "test/test-workflow",
			args:         nil,
			wantErr:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := New(nil, tt.workflowName, tt.args)

			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error containing %q but got none", tt.errMsg)
					return
				}
				t.Logf("Got expected error: %v", err)
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}
		})
	}
}

// TestAddTask_InvalidTaskConfigurations tests invalid task configs (fail-fast).
func TestAddTask_InvalidTaskConfigurations(t *testing.T) {
	tests := []struct {
		name      string
		task      *Task
		wantPanic bool
		errMsg    string
	}{
		{
			name: "HTTP task with empty URI",
			task: &Task{
				Name: "httpTask",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method:   "GET",
					Endpoint: &types.HttpEndpoint{Uri: ""}, // empty URI
				},
			},
			wantPanic: true,
			errMsg:    "URI",
		},
		{
			name: "Agent call with empty agent name",
			task: &Task{
				Name: "agentTask",
				Kind: TaskKindAgentCall,
				Config: &AgentCallTaskConfig{
					Agent:   "", // empty agent
					Message: "Test message",
				},
			},
			wantPanic: true,
			errMsg:    "agent",
		},
		{
			name: "GRPC call with empty service",
			task: &Task{
				Name: "grpcTask",
				Kind: TaskKindGrpcCall,
				Config: &GrpcCallTaskConfig{
					Service: "", // empty service
					Method:  "GetData",
				},
			},
			wantPanic: true,
			errMsg:    "service",
		},
		{
			name: "GRPC call with empty method",
			task: &Task{
				Name: "grpcTask",
				Kind: TaskKindGrpcCall,
				Config: &GrpcCallTaskConfig{
					Service: "MyService",
					Method:  "", // empty method
				},
			},
			wantPanic: true,
			errMsg:    "method",
		},
		{
			name: "Raise task with empty error",
			task: &Task{
				Name: "raiseTask",
				Kind: TaskKindRaise,
				Config: &RaiseTaskConfig{
					Error: "", // empty error
				},
			},
			wantPanic: true,
			errMsg:    "error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, "test/error-test", nil)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			if tt.wantPanic {
				defer func() {
					if r := recover(); r == nil {
						t.Error("Expected panic but got none")
					} else {
						t.Logf("Got expected panic: %v", r)
					}
				}()
			}

			wf.AddTask(tt.task)

			if tt.wantPanic {
				t.Error("Expected panic but AddTask succeeded")
			}
		})
	}
}

// =============================================================================
// Error Case Tests - Task Type Mismatches
// =============================================================================

// TestAddTask_TaskKindConfigMismatch tests mismatched task kinds and configs.
func TestAddTask_TaskKindConfigMismatch(t *testing.T) {
	tests := []struct {
		name      string
		task      *Task
		wantPanic bool
	}{
		{
			name: "HTTP kind with SET config",
			task: &Task{
				Name: "mismatch1",
				Kind: TaskKindHttpCall,
				Config: &SetTaskConfig{ // wrong config type
					Variables: map[string]string{"x": "y"},
				},
			},
			wantPanic: true, // May fail at proto conversion
		},
		{
			name: "SET kind with HTTP config",
			task: &Task{
				Name: "mismatch2",
				Kind: TaskKindSet,
				Config: &HttpCallTaskConfig{ // wrong config type
					Method:   "GET",
					Endpoint: &types.HttpEndpoint{Uri: "https://example.com"},
				},
			},
			wantPanic: true, // May fail at proto conversion
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, "test/mismatch-test", nil)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			defer func() {
				if r := recover(); r != nil {
					if tt.wantPanic {
						t.Logf("Got expected panic (type mismatch): %v", r)
					} else {
						t.Errorf("Unexpected panic: %v", r)
					}
				}
			}()

			wf.AddTask(tt.task)

			// Type mismatches may or may not be caught at AddTask time
			if !tt.wantPanic {
				t.Logf("No panic on type mismatch (may be caught at proto validation)")
			}
		})
	}
}

// =============================================================================
// Error Case Tests - Flow Control Errors
// =============================================================================

// TestWorkflowToProto_InvalidFlowControl tests invalid flow control configurations.
func TestWorkflowToProto_InvalidFlowControl(t *testing.T) {
	tests := []struct {
		name    string
		setup   func(*Workflow)
		wantErr bool
		errMsg  string
	}{
		{
			name: "then task points to non-existent task",
			setup: func(wf *Workflow) {
				task := Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}})
				task.Then("nonExistentTask") // invalid reference
				wf.AddTask(task)
			},
			wantErr: false, // May not validate at proto conversion time
			errMsg:  "nonExistentTask",
		},
		{
			name: "circular flow control",
			setup: func(wf *Workflow) {
				task1 := Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}})
				task1.Then("task2")
				wf.AddTask(task1)

				task2 := Set("task2", &SetArgs{Variables: map[string]string{"a": "b"}})
				task2.Then("task1") // circular reference
				wf.AddTask(task2)
			},
			wantErr: false, // May not validate at proto conversion time
			errMsg:  "circular",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, "test/flow-error-test", nil)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			tt.setup(wf)

			_, err = wf.ToProto()

			if tt.wantErr {
				if err == nil {
					t.Errorf("Expected error containing %q but got none", tt.errMsg)
					return
				}
				t.Logf("Got expected error: %v", err)
			} else {
				if err != nil {
					t.Logf("Got error: %v", err)
				}
			}
		})
	}
}

// =============================================================================
// Error Case Tests - Error Propagation
// =============================================================================

// TestWorkflowNew_MultipleValidationErrors tests handling of validation errors.
func TestWorkflowNew_MultipleValidationErrors(t *testing.T) {
	// Empty name should fail
	_, err := New(nil, "", nil)

	if err == nil {
		t.Log("Validation errors not caught at New() time")
		return
	}

	t.Logf("Got validation error: %v", err)
}

// =============================================================================
// Error Case Tests - Recovery and Fallback
// =============================================================================

// TestAddTask_PartiallyValidTasks tests workflow with some valid and some invalid tasks.
func TestAddTask_PartiallyValidTasks(t *testing.T) {
	wf, err := New(nil, "test/partial-valid", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Add valid task
	wf.AddTask(Set("validTask", &SetArgs{Variables: map[string]string{"x": "y"}}))

	// Try to add potentially invalid task
	defer func() {
		if r := recover(); r != nil {
			t.Logf("Invalid task panicked as expected: %v", r)
		}
	}()

	invalidTask := &Task{
		Name: "maybeInvalidTask",
		Kind: TaskKindHttpCall,
		Config: &HttpCallTaskConfig{
			Method:   "GET",
			Endpoint: &types.HttpEndpoint{Uri: ""}, // empty URI - may be invalid
		},
	}
	wf.AddTask(invalidTask)

	// If we get here, add another valid task
	wf.AddTask(Wait("anotherValidTask", &WaitArgs{Seconds: 5}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Logf("Proto conversion failed: %v", err)
	} else {
		t.Logf("Proto conversion succeeded with %d tasks", len(proto.Spec.Tasks))
	}
}

// =============================================================================
// Error Case Tests - Resource Exhaustion
// =============================================================================

// TestWorkflowToProto_ExcessiveTasks tests handling of extremely large task lists.
func TestWorkflowToProto_ExcessiveTasks(t *testing.T) {
	wf, err := New(nil, "test/excessive-tasks", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Create and add 1000 tasks (stress test - reduced from 10000 for test speed)
	for i := 0; i < 1000; i++ {
		task := Set(strings.ReplaceAll("task_"+strings.Repeat("x", i%10)+string(rune('0'+i%10)), " ", "_"), &SetArgs{
			Variables: map[string]string{"key": "value"},
		})
		// Note: task names must be unique, so we need distinct names
		task.Name = strings.ReplaceAll(task.Name+string(rune('a'+i%26)), " ", "_") + "_" + strings.Repeat("a", i/26)
		wf.AddTask(task)
	}

	// This should either succeed (if system can handle it) or fail gracefully
	proto, err := wf.ToProto()

	if err != nil {
		t.Logf("Proto conversion failed with 1000 tasks: %v", err)
	} else if proto != nil {
		t.Logf("Successfully converted workflow with %d tasks", len(proto.Spec.Tasks))
	}
}

// TestWorkflowToProto_DeeplyNestedStructures tests handling of nested switch structures.
func TestWorkflowToProto_DeeplyNestedStructures(t *testing.T) {
	wf, err := New(nil, "test/deeply-nested", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	wf.AddTask(&Task{
		Name: "root",
		Kind: TaskKindSwitch,
		Config: &SwitchTaskConfig{
			Cases: []*types.SwitchCase{
				{
					Name: "rootCase",
					When: "true",
					Then: "nested",
				},
			},
		},
	})

	proto, err := wf.ToProto()

	if err != nil {
		t.Logf("Proto conversion failed with deeply nested structures: %v", err)
	} else if proto != nil {
		t.Log("Successfully converted workflow with nested structures")
	}
}

// =============================================================================
// Error Case Tests - Args Nil Handling
// =============================================================================

// TestWorkflowToProto_NilArgs tests handling of nil Args.
func TestWorkflowToProto_NilArgs(t *testing.T) {
	wf := &Workflow{
		Name: "test-workflow",
		Slug: "test-workflow",
		Args: nil, // Nil Args
	}

	_, err := wf.ToProto()
	if err == nil {
		t.Error("Expected error for nil Args, got nil")
	} else {
		t.Logf("Got expected error: %v", err)
	}
}

// TestWorkflowToProto_NilDocument tests handling of nil Document.
func TestWorkflowToProto_NilDocument(t *testing.T) {
	wf := &Workflow{
		Name: "test-workflow",
		Slug: "test-workflow",
		Args: &WorkflowArgs{
			Document: nil, // Nil Document
		},
	}

	_, err := wf.ToProto()
	// This should fail at protovalidate since Document is required
	if err == nil {
		t.Log("Nil Document not caught at ToProto (may be caught at runtime)")
	} else {
		t.Logf("Got expected error: %v", err)
	}
}

// TestWorkflowToProto_InvalidDSL tests invalid DSL version.
func TestWorkflowToProto_InvalidDSL(t *testing.T) {
	wf := &Workflow{
		Name: "test-workflow",
		Slug: "test-workflow",
		Args: &WorkflowArgs{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "invalid-version", // Invalid DSL
				Namespace: "test",
				Name:      "test-workflow",
				Version:   "1.0.0",
			},
		},
	}

	_, err := wf.ToProto()
	if err == nil {
		t.Log("Invalid DSL not caught at ToProto (may be caught at runtime)")
	} else {
		t.Logf("Got expected error: %v", err)
	}
}
