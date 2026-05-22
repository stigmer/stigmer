package validation

import (
	"context"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestInProcessValidator_ValidWorkflow(t *testing.T) {
	config, _ := structpb.NewStruct(map[string]interface{}{
		"variables": map[string]interface{}{"greeting": "hello"},
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "basic-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "greet",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: config,
			},
		},
	}

	v := NewInProcessValidator()
	result, err := v.Validate(context.Background(), spec)
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}

	if result.State != serverlessv1.ValidationState_VALID {
		t.Errorf("Expected VALID, got %v. Errors: %v", result.State, result.Errors)
	}

	if result.Yaml == "" {
		t.Error("Expected non-empty YAML")
	}

	if result.ValidatedAt == nil {
		t.Error("Expected validated_at timestamp")
	}
}

func TestInProcessValidator_NilSpec(t *testing.T) {
	v := NewInProcessValidator()
	result, err := v.Validate(context.Background(), nil)
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}

	if result.State != serverlessv1.ValidationState_FAILED {
		t.Errorf("Expected FAILED for nil spec, got %v", result.State)
	}
}

func TestInProcessValidator_DuplicateTaskNames(t *testing.T) {
	config, _ := structpb.NewStruct(map[string]interface{}{
		"variables": map[string]interface{}{"x": "1"},
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "dup-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{Name: "step", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: config},
			{Name: "step", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: config},
		},
	}

	v := NewInProcessValidator()
	result, err := v.Validate(context.Background(), spec)
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}

	if result.State != serverlessv1.ValidationState_INVALID {
		t.Errorf("Expected INVALID for duplicate names, got %v", result.State)
	}

	if len(result.Errors) == 0 {
		t.Error("Expected validation errors")
	}

	if result.Yaml == "" {
		t.Error("Expected YAML to be present even on INVALID (helps debugging)")
	}
}

func TestInProcessValidator_BudgetWarnings(t *testing.T) {
	agentConfig, _ := structpb.NewStruct(map[string]interface{}{
		"agent":   "my-agent",
		"message": "do something",
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "budget-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "call_agent",
				Kind:       workflowv1.WorkflowTaskKind_agent_call,
				TaskConfig: agentConfig,
			},
		},
	}

	v := NewInProcessValidator()
	result, err := v.Validate(context.Background(), spec)
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}

	if result.State != serverlessv1.ValidationState_VALID {
		t.Errorf("Expected VALID (budget is a warning, not error), got %v. Errors: %v", result.State, result.Errors)
	}

	if len(result.Warnings) == 0 {
		t.Error("Expected budget warning for agent_call without budget")
	}
}

func TestInProcessValidator_MultipleTaskTypes(t *testing.T) {
	setConfig, _ := structpb.NewStruct(map[string]interface{}{
		"variables": map[string]interface{}{"initialized": "true"},
	})
	httpConfig, _ := structpb.NewStruct(map[string]interface{}{
		"method": "GET",
		"endpoint": map[string]interface{}{
			"uri": "https://api.example.com",
		},
	})
	agentConfig, _ := structpb.NewStruct(map[string]interface{}{
		"agent":   "test-agent",
		"message": "analyze this",
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "multi-task-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{Name: "init", Kind: workflowv1.WorkflowTaskKind_set_vars, TaskConfig: setConfig},
			{
				Name:       "fetch",
				Kind:       workflowv1.WorkflowTaskKind_http_call,
				TaskConfig: httpConfig,
				Export:     &workflowv1.Export{As: "${ . }"},
				Flow:       &workflowv1.FlowControl{Then: "analyze"},
			},
			{Name: "analyze", Kind: workflowv1.WorkflowTaskKind_agent_call, TaskConfig: agentConfig},
		},
	}

	v := NewInProcessValidator()
	result, err := v.Validate(context.Background(), spec)
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}

	if result.State != serverlessv1.ValidationState_VALID {
		t.Errorf("Expected VALID, got %v. Errors: %v", result.State, result.Errors)
	}

	if result.Yaml == "" {
		t.Error("Expected non-empty YAML")
	}
}
