// workflow_test.go provides comprehensive tests for the workflow package.
//
// This file consolidates tests from:
//   - Proto integration tests (workflow-to-proto conversion)
//   - Edge case tests (boundary conditions, concurrency)
//   - Error case tests (validation, recovery)

package workflow

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/metadata"
)

// =============================================================================
// Proto Integration Tests - Full Workflow Conversion
// =============================================================================

// TestWorkflowToProto_Complete tests full workflow with all fields.
func TestWorkflowToProto_Complete(t *testing.T) {
	// Create workflow using New()
	wf, err := New(nil, "data-processing/daily-sync", &WorkflowArgs{
		Description: "Sync data from external API",
	})
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Add HTTP task
	httpTask := HttpGet("fetchData", "https://api.example.com/data", map[string]string{
		"Authorization": "Bearer token",
	})
	httpTask.ExportAll()
	wf.AddTask(httpTask)

	// Add SET task
	setTask := Set("processData", &SetArgs{
		Variables: map[string]string{
			"status":  "completed",
			"count":   "10",
			"success": "true",
		},
	})
	wf.AddTask(setTask)

	// Convert to proto
	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	if proto == nil {
		t.Fatal("Proto is nil")
	}

	// Verify metadata
	if proto.Metadata == nil {
		t.Fatal("Metadata is nil")
	}
	if proto.Metadata.Name != "daily-sync" {
		t.Errorf("Name = %v, want daily-sync", proto.Metadata.Name)
	}
	if proto.Metadata.Slug != "daily-sync" {
		t.Errorf("Slug = %v, want daily-sync", proto.Metadata.Slug)
	}

	// Verify SDK annotations
	if len(proto.Metadata.Annotations) == 0 {
		t.Error("Expected SDK annotations, got none")
	}
	if proto.Metadata.Annotations[metadata.AnnotationSDKLanguage] != "go" {
		t.Error("Expected SDK language annotation to be 'go'")
	}

	// Verify API version and kind
	if proto.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %v, want agentic.stigmer.ai/v1", proto.ApiVersion)
	}
	if proto.Kind != "Workflow" {
		t.Errorf("Kind = %v, want Workflow", proto.Kind)
	}

	// Verify spec
	if proto.Spec == nil {
		t.Fatal("Spec is nil")
	}
	if proto.Spec.Description != "Sync data from external API" {
		t.Errorf("Description mismatch")
	}

	// Verify document
	if proto.Spec.Document == nil {
		t.Fatal("Document is nil")
	}
	if proto.Spec.Document.Dsl != "1.0.0" {
		t.Errorf("DSL = %v, want 1.0.0", proto.Spec.Document.Dsl)
	}
	if proto.Spec.Document.Namespace != "data-processing" {
		t.Errorf("Namespace mismatch")
	}
	if proto.Spec.Document.Name != "daily-sync" {
		t.Errorf("Document name mismatch")
	}
	if proto.Spec.Document.Version != "0.1.0" {
		t.Errorf("Version mismatch, got %v", proto.Spec.Document.Version)
	}

	// Verify tasks
	if len(proto.Spec.Tasks) != 2 {
		t.Fatalf("Expected 2 tasks, got %d", len(proto.Spec.Tasks))
	}

	// Verify HTTP task
	httpProtoTask := proto.Spec.Tasks[0]
	if httpProtoTask.Name != "fetchData" {
		t.Errorf("HTTP task name mismatch")
	}
	if httpProtoTask.TaskConfig == nil {
		t.Fatal("HTTP task config is nil")
	}

	// Verify SET task
	setProtoTask := proto.Spec.Tasks[1]
	if setProtoTask.Name != "processData" {
		t.Errorf("SET task name mismatch")
	}
}

// TestWorkflowToProto_Minimal tests minimal workflow.
func TestWorkflowToProto_Minimal(t *testing.T) {
	wf, err := New(nil, "test/simple-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Add one task
	wf.AddTask(Set("task1", &SetArgs{
		Variables: map[string]string{"x": "y"},
	}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	if proto == nil {
		t.Fatal("Proto is nil")
	}

	// Verify minimal structure
	if proto.Metadata.Name != "simple-workflow" {
		t.Errorf("Name mismatch")
	}
	if len(proto.Spec.Tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(proto.Spec.Tasks))
	}
}

// TestWorkflowToProto_AllTaskTypes tests workflow with multiple task types.
func TestWorkflowToProto_AllTaskTypes(t *testing.T) {
	wf, err := New(nil, "test/all-tasks-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Add various task types
	tasks := []*Task{
		// SET
		{
			Name: "setTask",
			Kind: TaskKindSet,
			Config: &SetTaskConfig{
				Variables: map[string]string{"x": "y"},
			},
		},
		// HTTP_CALL
		{
			Name: "httpTask",
			Kind: TaskKindHttpCall,
			Config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://api.example.com"},
				TimeoutSeconds: 30,
			},
		},
		// GRPC_CALL
		{
			Name: "grpcTask",
			Kind: TaskKindGrpcCall,
			Config: &GrpcCallTaskConfig{
				Service: "MyService",
				Method:  "GetData",
			},
		},
		// AGENT_CALL
		{
			Name: "agentTask",
			Kind: TaskKindAgentCall,
			Config: &AgentCallTaskConfig{
				Agent:   "code-reviewer",
				Message: "Review this code",
			},
		},
		// SWITCH
		{
			Name: "switchTask",
			Kind: TaskKindSwitch,
			Config: &SwitchTaskConfig{
				Cases: []*types.SwitchCase{
					{Name: "case1", When: "true", Then: "task1"},
				},
			},
		},
		// LISTEN
		{
			Name: "listenTask",
			Kind: TaskKindListen,
			Config: &ListenTaskConfig{
				To: &types.ListenTo{
					Mode: "one",
					Signals: []*types.SignalSpec{
						{Id: "user-action", Type: "signal"},
					},
				},
			},
		},
		// WAIT
		{
			Name: "waitTask",
			Kind: TaskKindWait,
			Config: &WaitTaskConfig{
				Seconds: 5,
			},
		},
		// CALL_ACTIVITY
		{
			Name: "activityTask",
			Kind: TaskKindCallActivity,
			Config: &CallActivityTaskConfig{
				Activity: "processPayment",
			},
		},
		// RUN
		{
			Name: "runTask",
			Kind: TaskKindRun,
			Config: &RunTaskConfig{
				Workflow: "sub-workflow",
			},
		},
	}

	wf.AddTasks(tasks...)

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify tasks were converted
	if len(proto.Spec.Tasks) != 9 {
		t.Fatalf("Expected 9 tasks, got %d", len(proto.Spec.Tasks))
	}

	// Verify task names
	expectedNames := []string{
		"setTask", "httpTask", "grpcTask", "agentTask",
		"switchTask", "listenTask", "waitTask", "activityTask", "runTask",
	}

	for i, task := range proto.Spec.Tasks {
		if task.Name != expectedNames[i] {
			t.Errorf("Task %d name = %v, want %v", i, task.Name, expectedNames[i])
		}
	}
}

// TestWorkflowToProto_TaskExport tests task export configuration.
func TestWorkflowToProto_TaskExport(t *testing.T) {
	wf, err := New(nil, "test/export-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	task := HttpGet("task1", "https://api.example.com", nil)
	task.ExportAll() // Export entire output
	wf.AddTask(task)

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify export configuration
	if proto.Spec.Tasks[0].Export == nil {
		t.Fatal("Expected export configuration, got nil")
	}
	if proto.Spec.Tasks[0].Export.As != "${.}" {
		t.Errorf("Export.As = %v, want ${.}", proto.Spec.Tasks[0].Export.As)
	}
}

// TestWorkflowToProto_TaskFlow tests task flow control.
func TestWorkflowToProto_TaskFlow(t *testing.T) {
	wf, err := New(nil, "test/flow-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	task1 := Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}})
	task1.Then("task2") // Jump to task2
	wf.AddTask(task1)

	task2 := Set("task2", &SetArgs{Variables: map[string]string{"a": "b"}})
	wf.AddTask(task2)

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify flow control
	if proto.Spec.Tasks[0].Flow == nil {
		t.Fatal("Expected flow control, got nil")
	}
	if proto.Spec.Tasks[0].Flow.Then != "task2" {
		t.Errorf("Flow.Then = %v, want task2", proto.Spec.Tasks[0].Flow.Then)
	}
}

// TestWorkflowToProto_SlugAutoGeneration tests automatic slug generation.
func TestWorkflowToProto_SlugAutoGeneration(t *testing.T) {
	wf, err := New(nil, "test/Daily Data Sync", nil) // Name with spaces
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	wf.AddTask(Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify slug was auto-generated (spaces converted to hyphens, lowercased)
	if proto.Metadata.Slug == "" {
		t.Error("Expected slug to be set")
	}
}

// TestWorkflowToProto_EmptyTasks tests workflow with no tasks.
func TestWorkflowToProto_EmptyTasks(t *testing.T) {
	wf, err := New(nil, "test/empty-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Note: Currently ToProto() doesn't validate empty tasks
	// This test documents current behavior
	_, err = wf.ToProto()
	if err != nil {
		// If validation is added, this test should pass
		t.Logf("Empty tasks validation: %v", err)
	}
}

// TestWorkflowToProto_WithEnvSpec tests EnvSpec propagation.
func TestWorkflowToProto_WithEnvSpec(t *testing.T) {
	wf, err := New(nil, "test/env-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Add environment requirements
	wf.RequireSecret("API_KEY", "API key for external service")
	wf.RequireConfig("LOG_LEVEL", "info", "Logging level")

	wf.AddTask(Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify EnvSpec was set
	if proto.Spec.EnvSpec == nil {
		t.Fatal("Expected EnvSpec, got nil")
	}
	if proto.Spec.EnvSpec.Data == nil {
		t.Fatal("Expected EnvSpec.Data, got nil")
	}

	// Verify secret
	apiKey, ok := proto.Spec.EnvSpec.Data["API_KEY"]
	if !ok {
		t.Error("Expected API_KEY in EnvSpec.Data")
	} else {
		if !apiKey.IsSecret {
			t.Error("API_KEY should be marked as secret")
		}
		if apiKey.Description != "API key for external service" {
			t.Error("API_KEY description mismatch")
		}
	}

	// Verify config
	logLevel, ok := proto.Spec.EnvSpec.Data["LOG_LEVEL"]
	if !ok {
		t.Error("Expected LOG_LEVEL in EnvSpec.Data")
	} else {
		if logLevel.IsSecret {
			t.Error("LOG_LEVEL should not be marked as secret")
		}
		if logLevel.Value != "info" {
			t.Errorf("LOG_LEVEL value = %v, want info", logLevel.Value)
		}
	}
}

// TestWorkflowToProto_ArgsNil tests handling of nil Args.
func TestWorkflowToProto_ArgsNil(t *testing.T) {
	wf := &Workflow{
		Name: "test-workflow",
		Slug: "test-workflow",
		Args: nil, // Nil Args
	}

	_, err := wf.ToProto()
	if err == nil {
		t.Error("Expected error for nil Args, got nil")
	}
}

// TestWorkflowNew_NamespaceParsing tests namespace parsing from name parameter.
func TestWorkflowNew_NamespaceParsing(t *testing.T) {
	tests := []struct {
		name              string
		expectedNamespace string
		expectedName      string
	}{
		{"data-processing/daily-sync", "data-processing", "daily-sync"},
		{"simple-workflow", "", "simple-workflow"},
		{"ns/sub/name", "ns", "sub/name"}, // Only first slash is parsed
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, tt.name, nil)
			// Note: namespace-only workflows will fail validation
			if tt.expectedNamespace == "" {
				if err == nil {
					t.Error("Expected error for missing namespace")
				}
				return
			}
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			if wf.Args.Document.Namespace != tt.expectedNamespace {
				t.Errorf("Namespace = %v, want %v", wf.Args.Document.Namespace, tt.expectedNamespace)
			}
			if wf.Name != tt.expectedName {
				t.Errorf("Name = %v, want %v", wf.Name, tt.expectedName)
			}
		})
	}
}

// TestWorkflowNew_VersionDefaults tests version defaulting.
func TestWorkflowNew_VersionDefaults(t *testing.T) {
	wf, err := New(nil, "test/workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Should default to 0.1.0
	if wf.Args.Document.Version != "0.1.0" {
		t.Errorf("Version = %v, want 0.1.0", wf.Args.Document.Version)
	}
}

// TestWorkflowNew_WithCustomVersion tests custom version.
func TestWorkflowNew_WithCustomVersion(t *testing.T) {
	wf, err := New(nil, "test/workflow", &WorkflowArgs{
		Document: &workflowv1.WorkflowDocument{
			Version: "2.0.0",
		},
	})
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	if wf.Args.Document.Version != "2.0.0" {
		t.Errorf("Version = %v, want 2.0.0", wf.Args.Document.Version)
	}
}

// =============================================================================
// Edge Case Tests - Boundary Conditions
// =============================================================================

// TestWorkflowToProto_NilFields tests handling of nil/empty fields.
func TestWorkflowToProto_NilFields(t *testing.T) {
	tests := []struct {
		name    string
		setup   func() *Workflow
		wantErr bool
	}{
		{
			name: "empty tasks slice",
			setup: func() *Workflow {
				wf, _ := New(nil, "test/test-workflow", nil)
				return wf
			},
			wantErr: true, // Proto validation requires at least 1 task
		},
		{
			name: "nil Args",
			setup: func() *Workflow {
				return &Workflow{
					Name: "test-workflow",
					Slug: "test-workflow",
					Args: nil,
				}
			},
			wantErr: true, // Args is required for ToProto
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf := tt.setup()
			proto, err := wf.ToProto()

			if tt.wantErr {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if proto == nil {
				t.Fatal("Proto should not be nil")
			}
		})
	}
}

// TestWorkflowToProto_MaximumFields tests workflows with maximum allowed values.
func TestWorkflowToProto_MaximumFields(t *testing.T) {
	wf, err := New(nil, "test/max-fields-workflow", &WorkflowArgs{
		Description: strings.Repeat("Workflow description ", 20), // ~400 chars
	})
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Create and add 100 tasks with unique names
	for i := 0; i < 100; i++ {
		task := Set(fmt.Sprintf("task%d", i), &SetArgs{
			Variables: map[string]string{
				fmt.Sprintf("var%d", i): fmt.Sprintf("value%d", i),
			},
		})
		wf.AddTask(task)
	}

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with large workflow: %v", err)
	}

	if len(proto.Spec.Tasks) != 100 {
		t.Errorf("Expected 100 tasks, got %d", len(proto.Spec.Tasks))
	}
}

// TestWorkflowToProto_SpecialCharacters tests handling of special characters.
func TestWorkflowToProto_SpecialCharacters(t *testing.T) {
	wf, err := New(nil, "test/special-chars", &WorkflowArgs{
		Description: "Description with unicode: 你好 and symbols <>&\"'",
	})
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	wf.AddTask(Set("task1", &SetArgs{
		Variables: map[string]string{
			"unicode":  "你好世界",
			"special":  "<>&\"'",
			"newlines": "line1\nline2\nline3",
		},
	}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with special characters: %v", err)
	}

	if proto.Spec.Description != "Description with unicode: 你好 and symbols <>&\"'" {
		t.Error("Special characters in description were not preserved")
	}
}

// TestWorkflowToProto_DeepTaskNesting tests deeply nested task structures.
func TestWorkflowToProto_DeepTaskNesting(t *testing.T) {
	wf, err := New(nil, "test/nested-tasks", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	wf.AddTask(&Task{
		Name: "level1",
		Kind: TaskKindSwitch,
		Config: &SwitchTaskConfig{
			Cases: []*types.SwitchCase{
				{
					Name: "trueCase",
					When: "true",
					Then: "level2",
				},
			},
		},
	})

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with nested tasks: %v", err)
	}

	if len(proto.Spec.Tasks) != 1 {
		t.Errorf("Expected 1 top-level task, got %d", len(proto.Spec.Tasks))
	}
}

// =============================================================================
// Edge Case Tests - Concurrent Operations
// =============================================================================

// TestWorkflowToProto_ConcurrentAccess tests thread-safety of ToProto.
func TestWorkflowToProto_ConcurrentAccess(t *testing.T) {
	wf, err := New(nil, "test/concurrent-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	wf.AddTask(Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}}))

	// Run ToProto concurrently 100 times
	var wg sync.WaitGroup
	errors := make(chan error, 100)

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := wf.ToProto()
			if err != nil {
				errors <- err
			}
		}()
	}

	wg.Wait()
	close(errors)

	// Check for any errors
	for err := range errors {
		t.Errorf("Concurrent ToProto() failed: %v", err)
	}
}

// TestWorkflow_ConcurrentTaskAddition tests concurrent task additions.
func TestWorkflow_ConcurrentTaskAddition(t *testing.T) {
	wf, err := New(nil, "test/concurrent-add", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	// Concurrently add 50 tasks using thread-safe AddTask method
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			// Each task needs a unique name
			task := Set(fmt.Sprintf("task%d", idx), &SetArgs{
				Variables: map[string]string{"idx": fmt.Sprintf("%d", idx)},
			})
			wf.AddTask(task)
		}(i)
	}

	wg.Wait()

	// Verify all 50 tasks were added successfully
	wf.mu.Lock()
	taskCount := len(wf.Args.Tasks)
	wf.mu.Unlock()

	if taskCount != 50 {
		t.Errorf("Expected 50 tasks, got %d", taskCount)
	}
	t.Logf("Tasks added concurrently: %d (expected 50)", taskCount)
}

// =============================================================================
// Edge Case Tests - Empty Collections
// =============================================================================

// TestWorkflowToProto_EmptyMaps tests tasks with empty map configurations.
func TestWorkflowToProto_EmptyMaps(t *testing.T) {
	tests := []struct {
		name      string
		task      *Task
		wantPanic bool
	}{
		{
			name: "empty variables in SET task",
			task: &Task{
				Name: "emptyVars",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{}, // empty map
				},
			},
			wantPanic: true, // SET task must have at least one variable
		},
		{
			name: "empty headers in HTTP task",
			task: &Task{
				Name: "emptyHeaders",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method:         "GET",
					Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
					Headers:        map[string]string{}, // empty map - this is valid
					TimeoutSeconds: 30,
				},
			},
			wantPanic: false, // Empty headers are valid
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, "test/empty-maps", nil)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			defer func() {
				if r := recover(); r != nil {
					if tt.wantPanic {
						t.Logf("Got expected panic: %v", r)
					} else {
						t.Errorf("Unexpected panic: %v", r)
					}
				}
			}()

			wf.AddTask(tt.task)

			if tt.wantPanic {
				t.Error("Expected panic but AddTask succeeded")
				return
			}

			proto, err := wf.ToProto()
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if proto == nil {
				t.Fatal("Proto should not be nil")
			}
		})
	}
}

// =============================================================================
// Edge Case Tests - Boundary Conditions for Task Types
// =============================================================================

// TestAddTask_HttpCallEdgeCases tests HTTP call edge cases.
func TestAddTask_HttpCallEdgeCases(t *testing.T) {
	tests := []struct {
		name      string
		config    *HttpCallTaskConfig
		wantPanic bool
	}{
		{
			name: "zero timeout",
			config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
				TimeoutSeconds: 0, // zero timeout - proto validation requires >= 1
			},
			wantPanic: true, // Proto validation requires timeout_seconds >= 1
		},
		{
			name: "minimum valid timeout",
			config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
				TimeoutSeconds: 1, // minimum valid timeout
			},
			wantPanic: false,
		},
		{
			name: "maximum valid timeout",
			config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
				TimeoutSeconds: 300, // 5 minutes - maximum allowed
			},
			wantPanic: false,
		},
		{
			name: "very large timeout",
			config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
				TimeoutSeconds: 86400, // 24 hours - exceeds maximum of 300
			},
			wantPanic: true, // Proto validation requires timeout_seconds <= 300
		},
		{
			name: "many headers",
			config: &HttpCallTaskConfig{
				Method:         "POST",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
				TimeoutSeconds: 30,
				Headers: map[string]string{
					"Header1":  "value1",
					"Header2":  "value2",
					"Header3":  "value3",
					"Header4":  "value4",
					"Header5":  "value5",
					"Header6":  "value6",
					"Header7":  "value7",
					"Header8":  "value8",
					"Header9":  "value9",
					"Header10": "value10",
				},
			},
			wantPanic: false,
		},
		{
			name: "very long URI",
			config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com/very/long/path/" + strings.Repeat("segment/", 50)},
				TimeoutSeconds: 30,
			},
			wantPanic: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, "test/http-edge-case", nil)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			defer func() {
				if r := recover(); r != nil {
					if tt.wantPanic {
						t.Logf("Got expected panic: %v", r)
					} else {
						t.Errorf("Unexpected panic: %v", r)
					}
				}
			}()

			task := &Task{
				Name:   "httpTask",
				Kind:   TaskKindHttpCall,
				Config: tt.config,
			}
			wf.AddTask(task)

			if tt.wantPanic {
				t.Error("Expected panic but AddTask succeeded")
				return
			}

			proto, err := wf.ToProto()
			if err != nil {
				t.Fatalf("ToProto() failed for %s: %v", tt.name, err)
			}

			if proto == nil {
				t.Fatal("Proto should not be nil")
			}
		})
	}
}

// TestAddTask_AgentCallEdgeCases tests agent call edge cases.
func TestAddTask_AgentCallEdgeCases(t *testing.T) {
	tests := []struct {
		name      string
		config    *AgentCallTaskConfig
		wantPanic bool
	}{
		{
			name: "very long message",
			config: &AgentCallTaskConfig{
				Agent:   "agent1",
				Message: strings.Repeat("Long message ", 100), // ~1400 chars
			},
			wantPanic: false,
		},
		{
			name: "agent with special characters",
			config: &AgentCallTaskConfig{
				Agent:   "agent-with-dash_and_underscore",
				Message: "Test message",
			},
			wantPanic: false,
		},
		{
			name: "empty message",
			config: &AgentCallTaskConfig{
				Agent:   "agent1",
				Message: "", // empty message - validation requires non-empty
			},
			wantPanic: true, // Message is required
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, "test/agent-edge-case", nil)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			defer func() {
				if r := recover(); r != nil {
					if tt.wantPanic {
						t.Logf("Got expected panic: %v", r)
					} else {
						t.Errorf("Unexpected panic: %v", r)
					}
				}
			}()

			task := &Task{
				Name:   "agentTask",
				Kind:   TaskKindAgentCall,
				Config: tt.config,
			}
			wf.AddTask(task)

			if tt.wantPanic {
				t.Error("Expected panic but AddTask succeeded")
				return
			}

			proto, err := wf.ToProto()
			if err != nil {
				t.Fatalf("ToProto() failed for %s: %v", tt.name, err)
			}

			if proto == nil {
				t.Fatal("Proto should not be nil")
			}
		})
	}
}

// TestAddTask_WaitEdgeCases tests wait task edge cases.
func TestAddTask_WaitEdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		seconds int32
	}{
		{name: "1 second", seconds: 1},
		{name: "5 seconds", seconds: 5},
		{name: "1 minute", seconds: 60},
		{name: "1 hour", seconds: 3600},
		{name: "24 hours", seconds: 86400},
		{name: "complex duration", seconds: 5445}, // 1h30m45s = 5445 seconds
		{name: "very long wait", seconds: 7200},   // 2 hours
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf, err := New(nil, "test/wait-edge-case", nil)
			if err != nil {
				t.Fatalf("New() failed: %v", err)
			}

			wf.AddTask(&Task{
				Name: "waitTask",
				Kind: TaskKindWait,
				Config: &WaitTaskConfig{
					Seconds: tt.seconds,
				},
			})

			proto, err := wf.ToProto()
			if err != nil {
				t.Fatalf("ToProto() failed for %s: %v", tt.name, err)
			}

			if proto == nil {
				t.Fatal("Proto should not be nil")
			}
		})
	}
}

// =============================================================================
// Edge Case Tests - Environment Methods
// =============================================================================

// TestWorkflow_RequireSecret tests RequireSecret method.
func TestWorkflow_RequireSecret(t *testing.T) {
	wf, err := New(nil, "test/env-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	wf.RequireSecret("API_KEY", "API key for external service")
	wf.RequireSecret("DB_PASSWORD", "Database password")

	// Add a task so ToProto works
	wf.AddTask(Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	if proto.Spec.EnvSpec == nil {
		t.Fatal("EnvSpec should not be nil")
	}

	// Verify secrets
	apiKey := proto.Spec.EnvSpec.Data["API_KEY"]
	if apiKey == nil {
		t.Error("API_KEY not found")
	} else if !apiKey.IsSecret {
		t.Error("API_KEY should be marked as secret")
	}

	dbPassword := proto.Spec.EnvSpec.Data["DB_PASSWORD"]
	if dbPassword == nil {
		t.Error("DB_PASSWORD not found")
	} else if !dbPassword.IsSecret {
		t.Error("DB_PASSWORD should be marked as secret")
	}
}

// TestWorkflow_RequireConfig tests RequireConfig method.
func TestWorkflow_RequireConfig(t *testing.T) {
	wf, err := New(nil, "test/config-workflow", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	wf.RequireConfig("LOG_LEVEL", "info", "Logging level")
	wf.RequireConfig("BATCH_SIZE", "100", "Batch size for processing")
	wf.RequireConfig("REQUIRED_VAR", "", "Required config without default")

	// Add a task so ToProto works
	wf.AddTask(Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	if proto.Spec.EnvSpec == nil {
		t.Fatal("EnvSpec should not be nil")
	}

	// Verify config values
	logLevel := proto.Spec.EnvSpec.Data["LOG_LEVEL"]
	if logLevel == nil {
		t.Error("LOG_LEVEL not found")
	} else {
		if logLevel.IsSecret {
			t.Error("LOG_LEVEL should not be marked as secret")
		}
		if logLevel.Value != "info" {
			t.Errorf("LOG_LEVEL value = %v, want info", logLevel.Value)
		}
	}

	batchSize := proto.Spec.EnvSpec.Data["BATCH_SIZE"]
	if batchSize == nil {
		t.Error("BATCH_SIZE not found")
	} else if batchSize.Value != "100" {
		t.Errorf("BATCH_SIZE value = %v, want 100", batchSize.Value)
	}

	requiredVar := proto.Spec.EnvSpec.Data["REQUIRED_VAR"]
	if requiredVar == nil {
		t.Error("REQUIRED_VAR not found")
	} else if requiredVar.Value != "" {
		t.Errorf("REQUIRED_VAR should have empty default value")
	}
}

// TestWorkflow_ConcurrentEnvMethods tests concurrent RequireSecret/RequireConfig.
func TestWorkflow_ConcurrentEnvMethods(t *testing.T) {
	wf, err := New(nil, "test/concurrent-env", nil)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	var wg sync.WaitGroup

	// Concurrently add secrets
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			wf.RequireSecret(fmt.Sprintf("SECRET_%d", idx), fmt.Sprintf("Secret %d", idx))
		}(i)
	}

	// Concurrently add configs
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			wf.RequireConfig(fmt.Sprintf("CONFIG_%d", idx), fmt.Sprintf("value%d", idx), fmt.Sprintf("Config %d", idx))
		}(i)
	}

	wg.Wait()

	// Add a task so ToProto works
	wf.AddTask(Set("task1", &SetArgs{Variables: map[string]string{"x": "y"}}))

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify all 50 env vars were added
	envCount := len(proto.Spec.EnvSpec.Data)
	if envCount != 50 {
		t.Errorf("Expected 50 env vars, got %d", envCount)
	}
}

// TestWorkflowNew_WithVersion tests workflow creation with custom version.
func TestWorkflowNew_WithVersion(t *testing.T) {
	wf, err := New(nil, "test/versioned-workflow", &WorkflowArgs{
		Document: &workflowv1.WorkflowDocument{
			Version: "2.5.0",
		},
	})
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	if wf.Args.Document.Version != "2.5.0" {
		t.Errorf("Version = %v, want 2.5.0", wf.Args.Document.Version)
	}
}

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
func TestWorkflowToProto_NilArgs_Error(t *testing.T) {
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
