package workflow

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/commons/metadata"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

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
