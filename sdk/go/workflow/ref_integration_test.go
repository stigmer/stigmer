package workflow_test

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// MockContext implements workflow.Context for testing
type MockContext struct {
	workflows []*workflow.Workflow
}

func (m *MockContext) RegisterWorkflow(wf *workflow.Workflow) {
	m.workflows = append(m.workflows, wf)
}

func TestWorkflow_NewWithContext(t *testing.T) {
	ctx := stigmer.NewContext()
	
	wf, err := workflow.New(ctx,
		workflow.WithNamespace("test"),
		workflow.WithName("test-workflow"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
	)
	
	if err != nil {
		t.Fatalf("NewWithContext() failed: %v", err)
	}
	
	if wf == nil {
		t.Fatal("NewWithContext() returned nil workflow")
	}
	
	if wf.Document.Namespace != "test" {
		t.Errorf("Expected namespace 'test', got '%s'", wf.Document.Namespace)
	}
	
	// Verify workflow was registered with context
	workflows := ctx.Workflows()
	if len(workflows) != 1 {
		t.Errorf("Expected 1 workflow registered, got %d", len(workflows))
	}
}

func TestWorkflow_NewWithoutContext(t *testing.T) {
	// Test that old API still works (backward compatibility)
	wf, err := workflow.New(
		workflow.WithNamespace("test"),
		workflow.WithName("test-workflow"),
		workflow.WithVersion("1.0.0"),
		workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
	)
	
	if err != nil {
		t.Fatalf("New() without context failed: %v", err)
	}
	
	if wf == nil {
		t.Fatal("New() returned nil workflow")
	}
	
	if wf.Document.Namespace != "test" {
		t.Errorf("Expected namespace 'test', got '%s'", wf.Document.Namespace)
	}
}

func TestTaskBuilder_WithURIStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	apiURL := ctx.SetString("apiURL", "https://api.example.com")
	
	task := workflow.HttpCallTask("fetch",
		workflow.WithHTTPGet(),
		workflow.WithURI(apiURL),
	)
	
	cfg, ok := task.Config.(*workflow.HttpCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not HttpCallTaskConfig")
	}
	
	expected := "${ $context.apiURL }"
	if cfg.URI != expected {
		t.Errorf("Expected URI '%s', got '%s'", expected, cfg.URI)
	}
}

func TestTaskBuilder_WithURIString(t *testing.T) {
	// Test backward compatibility - plain string should still work
	task := workflow.HttpCallTask("fetch",
		workflow.WithHTTPGet(),
		workflow.WithURI("https://api.example.com"),
	)
	
	cfg, ok := task.Config.(*workflow.HttpCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not HttpCallTaskConfig")
	}
	
	expected := "https://api.example.com"
	if cfg.URI != expected {
		t.Errorf("Expected URI '%s', got '%s'", expected, cfg.URI)
	}
}

func TestTaskBuilder_WithURIStringRefConcat(t *testing.T) {
	ctx := stigmer.NewContext()
	apiURL := ctx.SetString("apiURL", "https://api.example.com")
	endpoint := apiURL.Concat("/users")
	
	task := workflow.HttpCallTask("fetch",
		workflow.WithHTTPGet(),
		workflow.WithURI(endpoint),
	)
	
	cfg, ok := task.Config.(*workflow.HttpCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not HttpCallTaskConfig")
	}
	
	// Should generate expression with concatenation
	if !strings.Contains(cfg.URI, "$context.apiURL") {
		t.Errorf("Expected URI to contain '$context.apiURL', got '%s'", cfg.URI)
	}
	if !strings.Contains(cfg.URI, "/users") {
		t.Errorf("Expected URI to contain '/users', got '%s'", cfg.URI)
	}
}

func TestTaskBuilder_WithHeaderStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	token := ctx.SetSecret("token", "secret-token-123")
	
	task := workflow.HttpCallTask("fetch",
		workflow.WithHTTPGet(),
		workflow.WithURI("https://api.example.com"),
		workflow.WithHeader("Authorization", token),
	)
	
	cfg, ok := task.Config.(*workflow.HttpCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not HttpCallTaskConfig")
	}
	
	expected := "${ $context.token }"
	if cfg.Headers["Authorization"] != expected {
		t.Errorf("Expected header '%s', got '%s'", expected, cfg.Headers["Authorization"])
	}
}

func TestTaskBuilder_WithHeaderString(t *testing.T) {
	// Test backward compatibility
	task := workflow.HttpCallTask("fetch",
		workflow.WithHTTPGet(),
		workflow.WithURI("https://api.example.com"),
		workflow.WithHeader("Content-Type", "application/json"),
	)
	
	cfg, ok := task.Config.(*workflow.HttpCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not HttpCallTaskConfig")
	}
	
	expected := "application/json"
	if cfg.Headers["Content-Type"] != expected {
		t.Errorf("Expected header '%s', got '%s'", expected, cfg.Headers["Content-Type"])
	}
}

func TestTaskBuilder_WithTimeoutIntRef(t *testing.T) {
	ctx := stigmer.NewContext()
	timeout := ctx.SetInt("timeout", 60)
	
	task := workflow.HttpCallTask("fetch",
		workflow.WithHTTPGet(),
		workflow.WithURI("https://api.example.com"),
		workflow.WithTimeout(timeout),
	)
	
	cfg, ok := task.Config.(*workflow.HttpCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not HttpCallTaskConfig")
	}
	
	expected := int32(60)
	if cfg.TimeoutSeconds != expected {
		t.Errorf("Expected timeout %d, got %d", expected, cfg.TimeoutSeconds)
	}
}

func TestTaskBuilder_WithTimeoutInt(t *testing.T) {
	// Test backward compatibility
	task := workflow.HttpCallTask("fetch",
		workflow.WithHTTPGet(),
		workflow.WithURI("https://api.example.com"),
		workflow.WithTimeout(30),
	)
	
	cfg, ok := task.Config.(*workflow.HttpCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not HttpCallTaskConfig")
	}
	
	expected := int32(30)
	if cfg.TimeoutSeconds != expected {
		t.Errorf("Expected timeout %d, got %d", expected, cfg.TimeoutSeconds)
	}
}

func TestTaskBuilder_SetVarStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	apiURL := ctx.SetString("apiURL", "https://api.example.com")
	
	task := workflow.SetTask("init",
		workflow.SetVar("url", apiURL),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "${ $context.apiURL }"
	if cfg.Variables["url"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["url"])
	}
}

func TestTaskBuilder_SetVarString(t *testing.T) {
	// Test backward compatibility
	task := workflow.SetTask("init",
		workflow.SetVar("url", "https://api.example.com"),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "https://api.example.com"
	if cfg.Variables["url"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["url"])
	}
}

func TestTaskBuilder_SetIntIntRef(t *testing.T) {
	ctx := stigmer.NewContext()
	retries := ctx.SetInt("retries", 3)
	
	task := workflow.SetTask("init",
		workflow.SetInt("count", retries),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "${ $context.retries }"
	if cfg.Variables["count"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["count"])
	}
}

func TestTaskBuilder_SetIntInt(t *testing.T) {
	// Test backward compatibility
	task := workflow.SetTask("init",
		workflow.SetInt("count", 42),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "42"
	if cfg.Variables["count"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["count"])
	}
}

func TestTaskBuilder_SetStringStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	status := ctx.SetString("status", "pending")
	
	task := workflow.SetTask("init",
		workflow.SetString("state", status),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "${ $context.status }"
	if cfg.Variables["state"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["state"])
	}
}

func TestTaskBuilder_SetStringString(t *testing.T) {
	// Test backward compatibility
	task := workflow.SetTask("init",
		workflow.SetString("state", "pending"),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "pending"
	if cfg.Variables["state"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["state"])
	}
}

func TestTaskBuilder_SetBoolBoolRef(t *testing.T) {
	ctx := stigmer.NewContext()
	enabled := ctx.SetBool("enabled", true)
	
	task := workflow.SetTask("init",
		workflow.SetBool("isEnabled", enabled),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "${ $context.enabled }"
	if cfg.Variables["isEnabled"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["isEnabled"])
	}
}

func TestTaskBuilder_SetBoolBool(t *testing.T) {
	// Test backward compatibility
	task := workflow.SetTask("init",
		workflow.SetBool("isEnabled", true),
	)
	
	cfg, ok := task.Config.(*workflow.SetTaskConfig)
	if !ok {
		t.Fatal("Task config is not SetTaskConfig")
	}
	
	expected := "true"
	if cfg.Variables["isEnabled"] != expected {
		t.Errorf("Expected variable '%s', got '%s'", expected, cfg.Variables["isEnabled"])
	}
}

func TestTaskBuilder_WithServiceStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	service := ctx.SetString("service", "UserService")
	
	task := workflow.GrpcCallTask("call",
		workflow.WithService(service),
		workflow.WithGrpcMethod("GetUser"),
	)
	
	cfg, ok := task.Config.(*workflow.GrpcCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not GrpcCallTaskConfig")
	}
	
	expected := "${ $context.service }"
	if cfg.Service != expected {
		t.Errorf("Expected service '%s', got '%s'", expected, cfg.Service)
	}
}

func TestTaskBuilder_WithServiceString(t *testing.T) {
	// Test backward compatibility
	task := workflow.GrpcCallTask("call",
		workflow.WithService("UserService"),
		workflow.WithGrpcMethod("GetUser"),
	)
	
	cfg, ok := task.Config.(*workflow.GrpcCallTaskConfig)
	if !ok {
		t.Fatal("Task config is not GrpcCallTaskConfig")
	}
	
	expected := "UserService"
	if cfg.Service != expected {
		t.Errorf("Expected service '%s', got '%s'", expected, cfg.Service)
	}
}

func TestRefHelpers_toExpression(t *testing.T) {
	// This is tested indirectly through all the task builder tests above,
	// but we can add explicit tests if needed
}
