package workflow

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

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
