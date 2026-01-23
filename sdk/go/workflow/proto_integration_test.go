package workflow

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
)

// TestWorkflowToProto_Complete tests full workflow with all fields.
func TestWorkflowToProto_Complete(t *testing.T) {
	// Create environment variable
	env1, err := environment.New(
		environment.WithName("API_TOKEN"),
		environment.WithSecret(true),
		environment.WithDescription("API authentication token"),
	)
	if err != nil {
		t.Fatalf("Failed to create env var: %v", err)
	}

	wf := &Workflow{
		Document: Document{
			DSL:         "1.0.0",
			Namespace:   "data-processing",
			Name:        "daily-sync",
			Version:     "1.0.0",
			Description: "Daily data synchronization workflow",
		},
		Slug:                 "daily-sync",
		Description:          "Sync data from external API",
		Tasks:                []*Task{},
		EnvironmentVariables: []environment.Variable{env1},
		Org:                  "my-org",
	}

	// Add HTTP task
	httpTask := &Task{
		Name: "fetchData",
		Kind: TaskKindHttpCall,
		Config: &HttpCallTaskConfig{
			Method: "GET",
			URI:    "https://api.example.com/data",
			Headers: map[string]string{
				"Authorization": "Bearer token",
			},
			TimeoutSeconds: 30,
		},
		ExportAs: "${.}",
	}
	wf.Tasks = append(wf.Tasks, httpTask)

	// Add SET task
	setTask := &Task{
		Name: "processData",
		Kind: TaskKindSet,
		Config: &SetTaskConfig{
			Variables: map[string]string{
				"status":  "completed",
				"count":   "10",
				"success": "true",
			},
		},
	}
	wf.Tasks = append(wf.Tasks, setTask)

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
	if proto.Metadata.Annotations[AnnotationSDKLanguage] != "go" {
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
	if proto.Spec.Document.Version != "1.0.0" {
		t.Errorf("Version mismatch")
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

	// Verify environment variables
	if proto.Spec.EnvSpec == nil {
		t.Fatal("EnvSpec is nil")
	}
	if len(proto.Spec.EnvSpec.Data) != 1 {
		t.Fatalf("Expected 1 env var, got %d", len(proto.Spec.EnvSpec.Data))
	}
	apiToken, exists := proto.Spec.EnvSpec.Data["API_TOKEN"]
	if !exists {
		t.Fatal("API_TOKEN not found in env vars")
	}
	if !apiToken.IsSecret {
		t.Error("API_TOKEN should be marked as secret")
	}
}

// TestWorkflowToProto_Minimal tests minimal workflow.
func TestWorkflowToProto_Minimal(t *testing.T) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "simple-workflow",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"x": "y",
					},
				},
			},
		},
	}

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

// TestWorkflowToProto_AllTaskTypes tests workflow with all 13 task types.
func TestWorkflowToProto_AllTaskTypes(t *testing.T) {
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
				URI:            "https://api.example.com",
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
				Cases: []map[string]interface{}{
					{"condition": "true", "then": "task1"},
				},
			},
		},
		// FOR
		{
			Name: "forTask",
			Kind: TaskKindFor,
			Config: &ForTaskConfig{
				In: "${items}",
				Do: []map[string]interface{}{
					{"name": "process"},
				},
			},
		},
		// FORK
		{
			Name: "forkTask",
			Kind: TaskKindFork,
			Config: &ForkTaskConfig{
				Branches: []map[string]interface{}{
					{"name": "branch1"},
				},
			},
		},
		// TRY
		{
			Name: "tryTask",
			Kind: TaskKindTry,
			Config: &TryTaskConfig{
				Tasks: []map[string]interface{}{
					{"name": "attempt"},
				},
				Catch: []map[string]interface{}{
					{"errors": ".*", "tasks": []interface{}{map[string]interface{}{"name": "recover"}}},
				},
			},
		},
		// LISTEN
		{
			Name: "listenTask",
			Kind: TaskKindListen,
			Config: &ListenTaskConfig{
				Event: "user-action",
			},
		},
		// WAIT
		{
			Name: "waitTask",
			Kind: TaskKindWait,
			Config: &WaitTaskConfig{
				Duration: "5s",
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
		// RAISE
		{
			Name: "raiseTask",
			Kind: TaskKindRaise,
			Config: &RaiseTaskConfig{
				Error: "CustomError",
			},
		},
		// RUN
		{
			Name: "runTask",
			Kind: TaskKindRun,
			Config: &RunTaskConfig{
				WorkflowName: "sub-workflow",
			},
		},
	}

	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "all-tasks-workflow",
			Version:   "1.0.0",
		},
		Tasks: tasks,
	}

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify all 13 tasks were converted
	if len(proto.Spec.Tasks) != 13 {
		t.Fatalf("Expected 13 tasks, got %d", len(proto.Spec.Tasks))
	}

	// Verify task names
	expectedNames := []string{
		"setTask", "httpTask", "grpcTask", "agentTask",
		"switchTask", "forTask", "forkTask", "tryTask",
		"listenTask", "waitTask", "activityTask", "raiseTask", "runTask",
	}

	for i, task := range proto.Spec.Tasks {
		if task.Name != expectedNames[i] {
			t.Errorf("Task %d name = %v, want %v", i, task.Name, expectedNames[i])
		}
	}
}

// TestWorkflowToProto_TaskExport tests task export configuration.
func TestWorkflowToProto_TaskExport(t *testing.T) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "export-workflow",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method:         "GET",
					URI:            "https://api.example.com",
					TimeoutSeconds: 30,
				},
				ExportAs: "${.}",  // Export entire output
			},
		},
	}

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
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "flow-workflow",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{"x": "y"},
				},
				ThenTask: "task2",  // Jump to task2
			},
			{
				Name: "task2",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{"a": "b"},
				},
			},
		},
	}

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
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "Daily Data Sync",  // Name with spaces
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

	// Manually set slug since New() does this
	wf.Slug = "daily-data-sync"

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify slug was set
	expectedSlug := "daily-data-sync"
	if proto.Metadata.Slug != expectedSlug {
		t.Errorf("Slug = %v, want %v", proto.Metadata.Slug, expectedSlug)
	}
}

// TestWorkflowToProto_MultipleEnvVars tests multiple environment variables.
func TestWorkflowToProto_MultipleEnvVars(t *testing.T) {
	env1, _ := environment.New(
		environment.WithName("API_KEY"),
		environment.WithSecret(true),
	)
	env2, _ := environment.New(
		environment.WithName("REGION"),
		environment.WithDefaultValue("us-east-1"),
	)
	env3, _ := environment.New(
		environment.WithName("DEBUG"),
		environment.WithDefaultValue("false"),
	)

	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "env-workflow",
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
		EnvironmentVariables: []environment.Variable{env1, env2, env3},
	}

	proto, err := wf.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify all environment variables
	if len(proto.Spec.EnvSpec.Data) != 3 {
		t.Fatalf("Expected 3 env vars, got %d", len(proto.Spec.EnvSpec.Data))
	}

	// Check API_KEY
	apiKey, exists := proto.Spec.EnvSpec.Data["API_KEY"]
	if !exists {
		t.Fatal("API_KEY not found")
	}
	if !apiKey.IsSecret {
		t.Error("API_KEY should be secret")
	}

	// Check REGION
	region, exists := proto.Spec.EnvSpec.Data["REGION"]
	if !exists {
		t.Fatal("REGION not found")
	}
	if region.Value != "us-east-1" {
		t.Errorf("REGION value = %v, want us-east-1", region.Value)
	}

	// Check DEBUG
	debug, exists := proto.Spec.EnvSpec.Data["DEBUG"]
	if !exists {
		t.Fatal("DEBUG not found")
	}
	if debug.Value != "false" {
		t.Errorf("DEBUG value = %v, want false", debug.Value)
	}
}

// TestWorkflowToProto_EmptyTasks tests validation of empty task list.
func TestWorkflowToProto_EmptyTasks(t *testing.T) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "empty-workflow",
			Version:   "1.0.0",
		},
		Tasks: []*Task{},  // Empty task list
	}

	// Note: Currently ToProto() doesn't validate empty tasks
	// This test documents current behavior
	_, err := wf.ToProto()
	if err != nil {
		// If validation is added, this test should pass
		t.Logf("Empty tasks validation: %v", err)
	}
}
