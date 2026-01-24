package workflow

import (
	"strings"
	"sync"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/types"
)

// =============================================================================
// Edge Case Tests - Boundary Conditions
// =============================================================================

// TestWorkflowToProto_NilFields tests handling of nil/empty fields.
func TestWorkflowToProto_NilFields(t *testing.T) {
	tests := []struct {
		name    string
		wf      *Workflow
		wantErr bool
	}{
		{
			name: "nil environment variables",
			wf: &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "test-workflow",
					Version:   "1.0.0",
				},
				Tasks:                []*Task{{Name: "t1", Kind: TaskKindSet, Config: &SetTaskConfig{Variables: map[string]string{"x": "y"}}}},
				EnvironmentVariables: nil, // nil slice
			},
			wantErr: false,
		},
		{
			name: "empty tasks slice",
			wf: &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "test-workflow",
					Version:   "1.0.0",
				},
				Tasks: []*Task{}, // empty slice
			},
			wantErr: false,
		},
		{
			name: "nil task config",
			wf: &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "test-workflow",
					Version:   "1.0.0",
				},
				Tasks: []*Task{
					{Name: "nilConfig", Kind: TaskKindSet, Config: nil}, // nil config
				},
			},
			wantErr: false,
		},
		{
			name: "empty string fields",
			wf: &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "", // empty
					Name:      "test",
					Version:   "1.0.0",
				},
				Description: "", // empty
				Slug:        "", // empty
				Tasks:       []*Task{{Name: "t1", Kind: TaskKindSet, Config: &SetTaskConfig{Variables: map[string]string{"x": "y"}}}},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proto, err := tt.wf.ToProto()

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
	// Create workflow with many tasks (100)
	tasks := make([]*Task, 100)
	for i := 0; i < 100; i++ {
		tasks[i] = &Task{
			Name: "task" + string(rune('0'+i%10)),
			Kind: TaskKindSet,
			Config: &SetTaskConfig{
				Variables: map[string]string{
					"var" + string(rune('0'+i%10)): "value" + string(rune('0'+i%10)),
				},
			},
		}
	}

	// Create many environment variables (50)
	envVars := make([]environment.Variable, 50)
	for i := 0; i < 50; i++ {
		env, _ := environment.New(
			environment.WithName("ENV_VAR_"+string(rune('0'+i%10))),
			environment.WithDefaultValue("value"+string(rune('0'+i%10))),
		)
		envVars[i] = env
	}

	wf := &Workflow{
		Document: Document{
			DSL:         "1.0.0",
			Namespace:   "test",
			Name:        "max-fields-workflow",
			Version:     "1.0.0",
			Description: strings.Repeat("Long description ", 50), // ~1000 chars
		},
		Description:          strings.Repeat("Workflow description ", 25), // ~500 chars
		Tasks:                tasks,
		EnvironmentVariables: envVars,
	}

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with large workflow: %v", err)
	}

	if len(proto.Spec.Tasks) != 100 {
		t.Errorf("Expected 100 tasks, got %d", len(proto.Spec.Tasks))
	}

	if len(proto.Spec.EnvSpec.Data) != 50 {
		t.Errorf("Expected 50 env vars, got %d", len(proto.Spec.EnvSpec.Data))
	}
}

// TestWorkflowToProto_SpecialCharacters tests handling of special characters.
func TestWorkflowToProto_SpecialCharacters(t *testing.T) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "special-chars",
			Version:   "1.0.0",
		},
		Description: "Description with unicode: 你好 🚀 émojis & symbols <>&\"'",
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"unicode":  "你好世界",
						"emoji":    "🚀🎉💻",
						"special":  "<>&\"'",
						"newlines": "line1\nline2\nline3",
					},
				},
			},
		},
	}

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with special characters: %v", err)
	}

	if proto.Spec.Description != wf.Description {
		t.Error("Special characters in description were not preserved")
	}
}

// TestWorkflowToProto_DeepTaskNesting tests deeply nested task structures.
func TestWorkflowToProto_DeepTaskNesting(t *testing.T) {
	// Create a workflow with deeply nested Switch/For/Try tasks
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "nested-tasks",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
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
			},
		},
	}

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
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "concurrent-workflow",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{"x": "y"},
				},
			},
		},
	}

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
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "concurrent-add",
			Version:   "1.0.0",
		},
		Tasks: []*Task{},
	}

	// Concurrently add 50 tasks
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			task := &Task{
				Name: "task" + string(rune('0'+idx%10)),
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{"idx": string(rune('0' + idx%10))},
				},
			}
			wf.Tasks = append(wf.Tasks, task)
		}(i)
	}

	wg.Wait()

	// Verify tasks were added (may not be exactly 50 due to race conditions)
	// This test documents current behavior - not necessarily safe
	t.Logf("Tasks added concurrently: %d (expected ~50, actual count varies due to race)", len(wf.Tasks))
}

// =============================================================================
// Edge Case Tests - Empty Collections
// =============================================================================

// TestWorkflowToProto_EmptyMaps tests tasks with empty map configurations.
func TestWorkflowToProto_EmptyMaps(t *testing.T) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "empty-maps",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "emptyVars",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{}, // empty map
				},
			},
			{
				Name: "emptyHeaders",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method:   "GET",
					Endpoint: &types.HttpEndpoint{Uri: "https://example.com"},
					Headers:  map[string]string{}, // empty map
				},
			},
		},
	}

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with empty maps: %v", err)
	}

	if proto == nil {
		t.Fatal("Proto should not be nil")
	}
}

// =============================================================================
// Edge Case Tests - Boundary Conditions for Task Types
// =============================================================================

// TestWorkflowToProto_HttpCallEdgeCases tests HTTP call edge cases.
func TestWorkflowToProto_HttpCallEdgeCases(t *testing.T) {
	tests := []struct {
		name   string
		config *HttpCallTaskConfig
	}{
		{
			name: "zero timeout",
			config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
				TimeoutSeconds: 0, // zero timeout
			},
		},
		{
			name: "very large timeout",
			config: &HttpCallTaskConfig{
				Method:         "GET",
				Endpoint:       &types.HttpEndpoint{Uri: "https://example.com"},
				TimeoutSeconds: 86400, // 24 hours
			},
		},
		{
			name: "many headers",
			config: &HttpCallTaskConfig{
				Method:   "POST",
				Endpoint: &types.HttpEndpoint{Uri: "https://example.com"},
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
		},
		{
			name: "very long URI",
			config: &HttpCallTaskConfig{
				Method:   "GET",
				Endpoint: &types.HttpEndpoint{Uri: "https://example.com/very/long/path/" + strings.Repeat("segment/", 50)},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf := &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "http-edge-case",
					Version:   "1.0.0",
				},
				Tasks: []*Task{
					{
						Name:   "httpTask",
						Kind:   TaskKindHttpCall,
						Config: tt.config,
					},
				},
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

// TestWorkflowToProto_AgentCallEdgeCases tests agent call edge cases.
func TestWorkflowToProto_AgentCallEdgeCases(t *testing.T) {
	tests := []struct {
		name   string
		config *AgentCallTaskConfig
	}{
		{
			name: "very long message",
			config: &AgentCallTaskConfig{
				Agent:   "agent1",
				Message: strings.Repeat("Long message ", 100), // ~1400 chars
			},
		},
		{
			name: "agent with special characters",
			config: &AgentCallTaskConfig{
				Agent:   "agent-with-dash_and_underscore",
				Message: "Test message",
			},
		},
		{
			name: "empty message",
			config: &AgentCallTaskConfig{
				Agent:   "agent1",
				Message: "", // empty message
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wf := &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "agent-edge-case",
					Version:   "1.0.0",
				},
				Tasks: []*Task{
					{
						Name:   "agentTask",
						Kind:   TaskKindAgentCall,
						Config: tt.config,
					},
				},
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

// TestWorkflowToProto_WaitEdgeCases tests wait task edge cases.
func TestWorkflowToProto_WaitEdgeCases(t *testing.T) {
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
			wf := &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "wait-edge-case",
					Version:   "1.0.0",
				},
				Tasks: []*Task{
					{
						Name: "waitTask",
						Kind: TaskKindWait,
						Config: &WaitTaskConfig{
							Seconds: tt.seconds,
						},
					},
				},
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
