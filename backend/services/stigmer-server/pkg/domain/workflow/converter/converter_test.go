package converter

import (
	"reflect"
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/types/known/structpb"
	"gopkg.in/yaml.v3"
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
		"run_config": map[string]interface{}{
			"model_name":   "claude-sonnet-4",
			"max_cost_usd": 0.5,
			"service_tier": "SERVICE_TIER_STANDARD",
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
		{"run_config:", "run config block"},
		{"model_name: claude-sonnet-4", "model override"},
		{"max_cost_usd:", "per-task budget cap"},
		{"service_tier: standard", "service tier shorthand (#357)"},
	}

	for _, c := range checks {
		if !strings.Contains(yaml, c.substr) {
			t.Errorf("YAML should contain %s (%q), got:\n%s", c.desc, c.substr, yaml)
		}
	}
}

// TestProtoToYAML_AgentCallEmissionContract pins the cross-edition emission
// contract for agent_call (issue #358): this converter and the cloud Java
// InProcessWorkflowValidator must emit a `with:` block with exactly these
// keys and values for this fixture — the runner executes whichever
// edition's YAML was stored at validation time, so divergence here means
// the two editions execute different workflows from the same spec. The
// Java twin (InProcessWorkflowValidatorTest#agentCallEmissionContract)
// pins the same fixture; change both together or not at all. The contract
// is parsed structural equality of the with-block, not byte equality of
// the YAML (the editions order map keys differently).
func TestProtoToYAML_AgentCallEmissionContract(t *testing.T) {
	config, _ := structpb.NewStruct(map[string]interface{}{
		"agent":   "acme/code-reviewer",
		"message": "Review ${ $context.pr.diff }",
		"env": map[string]interface{}{
			"GITHUB_TOKEN": "${ .secrets.GH }",
		},
		"run_config": map[string]interface{}{
			"model_name":      "claude-sonnet-4-6",
			"max_cost_usd":    0.5,
			"max_tool_rounds": float64(15),
			"service_tier":    "fast",
		},
		"output": map[string]interface{}{
			"schema":        map[string]interface{}{"type": "object"},
			"on_invalid":    "ON_INVALID_RETRY",
			"max_retries":   float64(2),
			"fallback_task": "review_fallback",
		},
		"harness": "cursor",
		"workspace_entries": []interface{}{
			map[string]interface{}{
				"name": "app",
				"source": map[string]interface{}{
					"git_repo": map[string]interface{}{
						"url":    "https://github.com/acme/app",
						"branch": "main",
					},
				},
			},
		},
		"environment_refs": []interface{}{
			map[string]interface{}{"slug": "shared-secrets"},
		},
	})
	fallbackConfig, _ := structpb.NewStruct(map[string]interface{}{
		"variables": map[string]interface{}{"done": "true"},
	})

	spec := &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "agent-emission-contract",
			Version:   "1.0.0",
		},
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "review",
				Kind:       workflowv1.WorkflowTaskKind_agent_call,
				TaskConfig: config,
			},
			{
				Name:       "review_fallback",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: fallbackConfig,
			},
		},
	}

	yamlStr, err := NewConverter().ProtoToYAML(spec)
	if err != nil {
		t.Fatalf("ProtoToYAML failed: %v", err)
	}

	var parsed map[string]interface{}
	if err := yaml.Unmarshal([]byte(yamlStr), &parsed); err != nil {
		t.Fatalf("emitted YAML does not parse: %v", err)
	}

	doTasks, ok := parsed["do"].([]interface{})
	if !ok || len(doTasks) != 2 {
		t.Fatalf("expected 2 do-tasks, got %v", parsed["do"])
	}
	reviewTask, ok := doTasks[0].(map[string]interface{})["review"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing 'review' task in %v", doTasks[0])
	}
	if reviewTask["call"] != "agent" {
		t.Fatalf("expected call: agent, got %v", reviewTask["call"])
	}

	expectedWith := map[string]interface{}{
		"agent":   "acme/code-reviewer",
		"message": "Review ${ $context.pr.diff }",
		"env": map[string]interface{}{
			"GITHUB_TOKEN": "${ .secrets.GH }",
		},
		"run_config": map[string]interface{}{
			"model_name":      "claude-sonnet-4-6",
			"max_cost_usd":    0.5,
			"max_tool_rounds": 15,
			"service_tier":    "fast",
		},
		"output": map[string]interface{}{
			"schema":        map[string]interface{}{"type": "object"},
			"on_invalid":    "ON_INVALID_RETRY",
			"max_retries":   2,
			"fallback_task": "review_fallback",
		},
		"harness": "cursor",
		// workspace_entries pass through to the runner; environment_refs
		// deliberately do NOT (resolved server-side from the Workflow row —
		// see the emission comment in task_converters.go).
		"workspace_entries": []interface{}{
			map[string]interface{}{
				"name": "app",
				"source": map[string]interface{}{
					"git_repo": map[string]interface{}{
						"url":    "https://github.com/acme/app",
						"branch": "main",
					},
				},
			},
		},
	}

	if !reflect.DeepEqual(reviewTask["with"], expectedWith) {
		t.Errorf("agent_call with-block diverges from the pinned emission contract.\ngot:  %#v\nwant: %#v",
			reviewTask["with"], expectedWith)
	}
}

// TestUnmarshalTaskConfig_EnvironmentRefKindDefault verifies the DSL
// normalizer: an environment_refs item that omits kind unmarshals with
// kind=environment — the field can reference nothing else, so requiring
// authors to spell it would be ceremony.
func TestUnmarshalTaskConfig_EnvironmentRefKindDefault(t *testing.T) {
	config, _ := structpb.NewStruct(map[string]interface{}{
		"agent":   "triage",
		"message": "classify",
		"environment_refs": []interface{}{
			map[string]interface{}{"slug": "shared-secrets"},
			map[string]interface{}{"org": "acme", "slug": "other", "kind": "environment"},
		},
	})

	msg, err := UnmarshalTaskConfigPublic(workflowv1.WorkflowTaskKind_agent_call, config)
	if err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	cfg, ok := msg.(*tasksv1.AgentCallTaskConfig)
	if !ok {
		t.Fatalf("expected AgentCallTaskConfig, got %T", msg)
	}
	if len(cfg.GetEnvironmentRefs()) != 2 {
		t.Fatalf("expected 2 environment refs, got %d", len(cfg.GetEnvironmentRefs()))
	}
	for i, ref := range cfg.GetEnvironmentRefs() {
		if ref.GetKind() != apiresourcekind.ApiResourceKind_environment {
			t.Errorf("environment_refs[%d].kind = %v, want environment", i, ref.GetKind())
		}
	}
	if cfg.GetEnvironmentRefs()[0].GetSlug() != "shared-secrets" {
		t.Errorf("environment_refs[0].slug = %q, want shared-secrets", cfg.GetEnvironmentRefs()[0].GetSlug())
	}
	if cfg.GetEnvironmentRefs()[1].GetOrg() != "acme" {
		t.Errorf("environment_refs[1].org = %q, want acme", cfg.GetEnvironmentRefs()[1].GetOrg())
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
