package converter

import (
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestProtoToYAML_BasicSetVars(t *testing.T) {
	vars, _ := structpb.NewStruct(map[string]interface{}{
		"variables": map[string]interface{}{
			"greeting": "hello",
			"count":    "42",
		},
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
				TaskConfig: vars,
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	if err != nil {
		t.Fatalf("ProtoToYAML failed: %v", err)
	}

	if !strings.Contains(yaml, "document:") {
		t.Error("YAML should contain document block")
	}
	if !strings.Contains(yaml, "dsl: \"1.0.0\"") && !strings.Contains(yaml, "dsl: 1.0.0") {
		t.Error("YAML should contain dsl version")
	}
	if !strings.Contains(yaml, "do:") {
		t.Error("YAML should contain do block")
	}
	if !strings.Contains(yaml, "greet:") {
		t.Error("YAML should contain task name 'greet'")
	}
	if !strings.Contains(yaml, "set:") {
		t.Error("YAML should contain 'set:' for set_vars task")
	}
}

func TestProtoToYAML_HttpCall(t *testing.T) {
	config, _ := structpb.NewStruct(map[string]interface{}{
		"method": "GET",
		"endpoint": map[string]interface{}{
			"uri": "https://api.example.com/data",
		},
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "http-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "fetch",
				Kind:       workflowv1.WorkflowTaskKind_http_call,
				TaskConfig: config,
				Export:     &workflowv1.Export{As: "${ . }"},
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	if err != nil {
		t.Fatalf("ProtoToYAML failed: %v", err)
	}

	if !strings.Contains(yaml, "call: http") {
		t.Error("YAML should contain 'call: http'")
	}
	if !strings.Contains(yaml, "export:") {
		t.Error("YAML should contain 'export:'")
	}
}

func TestProtoToYAML_AgentCall(t *testing.T) {
	config, _ := structpb.NewStruct(map[string]interface{}{
		"agent":   "my-agent",
		"message": "do something",
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "agent-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "call_agent",
				Kind:       workflowv1.WorkflowTaskKind_agent_call,
				TaskConfig: config,
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	if err != nil {
		t.Fatalf("ProtoToYAML failed: %v", err)
	}

	if !strings.Contains(yaml, "call: agent") {
		t.Error("YAML should contain 'call: agent'")
	}
	if !strings.Contains(yaml, "agent: my-agent") {
		t.Error("YAML should contain agent slug")
	}
}

func TestProtoToYAML_AgentCallWithOutputContract(t *testing.T) {
	schema, _ := structpb.NewStruct(map[string]interface{}{
		"type":     "object",
		"required": []interface{}{"severity", "category"},
		"properties": map[string]interface{}{
			"severity": map[string]interface{}{
				"type": "string",
				"enum": []interface{}{"low", "medium", "high", "critical"},
			},
			"category": map[string]interface{}{
				"type": "string",
			},
		},
	})

	config, _ := structpb.NewStruct(map[string]interface{}{
		"agent":   "triage-agent",
		"message": "Analyze: ${ $context.fetch.body }",
		"output": map[string]interface{}{
			"schema":        schema.AsMap(),
			"on_invalid":    "ON_INVALID_RETRY",
			"max_retries":   float64(3),
			"fallback_task": "human_review",
		},
		"config": map[string]interface{}{
			"model":           "claude-sonnet-4",
			"timeout":         float64(300),
			"max_cost_micros": float64(500000),
		},
		"harness": "HARNESS_CURSOR",
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "agent-output-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "triage",
				Kind:       workflowv1.WorkflowTaskKind_agent_call,
				TaskConfig: config,
				Export:     &workflowv1.Export{As: "${ .structured }"},
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	if err != nil {
		t.Fatalf("ProtoToYAML failed: %v", err)
	}

	checks := []struct {
		substr string
		desc   string
	}{
		{"call: agent", "agent call type"},
		{"agent: triage-agent", "agent slug"},
		{"output:", "output contract block"},
		{"schema:", "output schema"},
		{"severity", "schema property name"},
		{"on_invalid:", "on_invalid policy"},
		{"ON_INVALID_RETRY", "on_invalid enum value"},
		{"max_retries:", "max retries"},
		{"fallback_task: human_review", "fallback task"},
		{"export:", "export block"},
		{"harness: cursor", "cursor harness"},
		{"max_cost_micros:", "per-task budget cap"},
	}

	for _, c := range checks {
		if !strings.Contains(yaml, c.substr) {
			t.Errorf("YAML should contain %s (%q), got:\n%s", c.desc, c.substr, yaml)
		}
	}
}

func TestProtoToYAML_FlowControl(t *testing.T) {
	config, _ := structpb.NewStruct(map[string]interface{}{
		"variables": map[string]interface{}{"x": "1"},
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "flow-test",
			Version:   "0.1.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "step_a",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: config,
				Flow:       &workflowv1.FlowControl{Then: "step_b"},
			},
			{
				Name:       "step_b",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: config,
				Flow:       &workflowv1.FlowControl{Then: "end"},
			},
		},
	}

	conv := NewConverter()
	yaml, err := conv.ProtoToYAML(spec)
	if err != nil {
		t.Fatalf("ProtoToYAML failed: %v", err)
	}

	if !strings.Contains(yaml, "then: step_b") {
		t.Error("YAML should contain flow.then directive")
	}
	if !strings.Contains(yaml, "then: end") {
		t.Error("YAML should contain then: end")
	}
}

func TestProtoToYAML_NilSpec(t *testing.T) {
	conv := NewConverter()
	_, err := conv.ProtoToYAML(nil)
	if err == nil {
		t.Error("Expected error for nil spec")
	}
}

func TestProtoToYAML_NilDocument(t *testing.T) {
	conv := NewConverter()
	_, err := conv.ProtoToYAML(&workflowv1.WorkflowSpec{})
	if err == nil {
		t.Error("Expected error for nil document")
	}
}

func TestProtoToYAML_NoTasks(t *testing.T) {
	conv := NewConverter()
	_, err := conv.ProtoToYAML(&workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "empty",
			Version:   "0.1.0",
		},
	})
	if err == nil {
		t.Error("Expected error for empty tasks")
	}
}
