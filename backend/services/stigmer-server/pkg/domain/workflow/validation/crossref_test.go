package validation

import (
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func makeTask(name string, kind workflowv1.WorkflowTaskKind, config map[string]interface{}) *workflowv1.WorkflowTask {
	cfg, _ := structpb.NewStruct(config)
	return &workflowv1.WorkflowTask{
		Name:       name,
		Kind:       kind,
		TaskConfig: cfg,
	}
}

func TestValidateCrossTaskReferences_UniqueNames(t *testing.T) {
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": "1"}}
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			makeTask("step_a", workflowv1.WorkflowTaskKind_set_vars, cfg),
			makeTask("step_a", workflowv1.WorkflowTaskKind_set_vars, cfg),
		},
	}

	errors := ValidateCrossTaskReferences(spec)
	if len(errors) == 0 {
		t.Error("Expected duplicate name error")
	}
	if !strings.Contains(errors[0], "duplicate task name") {
		t.Errorf("Expected 'duplicate task name' error, got: %s", errors[0])
	}
}

func TestValidateCrossTaskReferences_InvalidFlowThen(t *testing.T) {
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": "1"}}
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "step_a",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
				Flow:       &workflowv1.FlowControl{Then: "nonexistent"},
			},
		},
	}

	errors := ValidateCrossTaskReferences(spec)
	if len(errors) == 0 {
		t.Error("Expected unknown task reference error")
	}
	if !strings.Contains(errors[0], "unknown task 'nonexistent'") {
		t.Errorf("Expected unknown task error, got: %s", errors[0])
	}
}

func TestValidateCrossTaskReferences_ValidFlowEnd(t *testing.T) {
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": "1"}}
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "step_a",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
				Flow:       &workflowv1.FlowControl{Then: "end"},
			},
		},
	}

	errors := ValidateCrossTaskReferences(spec)
	if len(errors) > 0 {
		t.Errorf("Expected no errors for flow.then='end', got: %v", errors)
	}
}

func TestValidateCrossTaskReferences_CycleDetection(t *testing.T) {
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": "1"}}
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "step_a",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
				Flow:       &workflowv1.FlowControl{Then: "step_b"},
			},
			{
				Name:       "step_b",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
				Flow:       &workflowv1.FlowControl{Then: "step_a"},
			},
		},
	}

	errors := ValidateCrossTaskReferences(spec)
	hasCycleError := false
	for _, e := range errors {
		if strings.Contains(e, "circular dependency") {
			hasCycleError = true
			break
		}
	}
	if !hasCycleError {
		t.Errorf("Expected cycle detection error, got: %v", errors)
	}
}

func TestValidateCrossTaskReferences_ValidWorkflow(t *testing.T) {
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": "1"}}
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "step_a",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
				Flow:       &workflowv1.FlowControl{Then: "step_b"},
			},
			{
				Name:       "step_b",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
				Flow:       &workflowv1.FlowControl{Then: "end"},
			},
		},
	}

	errors := ValidateCrossTaskReferences(spec)
	if len(errors) > 0 {
		t.Errorf("Expected no errors for valid workflow, got: %v", errors)
	}
}

func TestValidateCrossTaskReferences_DidYouMean(t *testing.T) {
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": "1"}}
	spec := &workflowv1.WorkflowSpec{
		Tasks: []*workflowv1.WorkflowTask{
			{
				Name:       "step_a",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
				Flow:       &workflowv1.FlowControl{Then: "step_ab"},
			},
			{
				Name:       "step_b",
				Kind:       workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: mustStruct(cfg),
			},
		},
	}

	errors := ValidateCrossTaskReferences(spec)
	if len(errors) == 0 {
		t.Error("Expected error for typo reference")
	}
	hasSuggestion := false
	for _, e := range errors {
		if strings.Contains(e, "did you mean") {
			hasSuggestion = true
			break
		}
	}
	if !hasSuggestion {
		t.Errorf("Expected 'did you mean' suggestion, got: %v", errors)
	}
}

func mustStruct(m map[string]interface{}) *structpb.Struct {
	s, _ := structpb.NewStruct(m)
	return s
}

// RunConfig's gte-0 bounds are enforced here at Layer 2 because Layer-1
// protovalidate cannot see inside the task_config Struct envelope. The
// error strings are pinned in lockstep with the cloud Java validator.
func TestValidateTaskConfigRequiredFields_AgentCallRunConfigBounds(t *testing.T) {
	makeSpec := func(runConfig map[string]interface{}) *workflowv1.WorkflowSpec {
		return &workflowv1.WorkflowSpec{
			Tasks: []*workflowv1.WorkflowTask{
				makeTask("triage", workflowv1.WorkflowTaskKind_agent_call, map[string]interface{}{
					"agent":      "test-agent",
					"message":    "test message",
					"run_config": runConfig,
				}),
			},
		}
	}

	t.Run("negative max_cost_usd is rejected", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec(map[string]interface{}{
			"max_cost_usd": -0.5,
		}))
		want := "task 'triage' (agent_call): run_config.max_cost_usd must be >= 0"
		if len(errors) != 1 || errors[0] != want {
			t.Errorf("expected [%q], got %v", want, errors)
		}
	})

	t.Run("negative max_tool_rounds is rejected", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec(map[string]interface{}{
			"max_tool_rounds": float64(-1),
		}))
		want := "task 'triage' (agent_call): run_config.max_tool_rounds must be >= 0"
		if len(errors) != 1 || errors[0] != want {
			t.Errorf("expected [%q], got %v", want, errors)
		}
	})

	t.Run("valid bounds pass", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec(map[string]interface{}{
			"model_name":      "claude-sonnet-4-6",
			"max_cost_usd":    0.5,
			"max_tool_rounds": float64(15),
		}))
		if len(errors) != 0 {
			t.Errorf("expected no errors, got %v", errors)
		}
	})

	t.Run("absent run_config passes", func(t *testing.T) {
		spec := &workflowv1.WorkflowSpec{
			Tasks: []*workflowv1.WorkflowTask{
				makeTask("triage", workflowv1.WorkflowTaskKind_agent_call, map[string]interface{}{
					"agent":   "test-agent",
					"message": "test message",
				}),
			},
		}
		if errors := ValidateTaskConfigRequiredFields(spec); len(errors) != 0 {
			t.Errorf("expected no errors, got %v", errors)
		}
	})
}

// The workflow surface accepts git_repo workspace sources only (no client
// is connected to serve a local_path when a task fires) and mirrors
// GitRepoSource's https-only proto CEL, unreachable at Layer 1 through the
// Struct envelope. Error strings are pinned in lockstep with the cloud
// Java validator.
func TestValidateTaskConfigRequiredFields_AgentCallWorkspaceEntries(t *testing.T) {
	makeSpec := func(entries []interface{}) *workflowv1.WorkflowSpec {
		return &workflowv1.WorkflowSpec{
			Tasks: []*workflowv1.WorkflowTask{
				makeTask("review", workflowv1.WorkflowTaskKind_agent_call, map[string]interface{}{
					"agent":             "test-agent",
					"message":           "test message",
					"workspace_entries": entries,
				}),
			},
		}
	}

	t.Run("git https entry passes", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec([]interface{}{
			map[string]interface{}{
				"name": "app",
				"source": map[string]interface{}{
					"git_repo": map[string]interface{}{"url": "https://github.com/acme/app"},
				},
			},
		}))
		if len(errors) != 0 {
			t.Errorf("expected no errors, got %v", errors)
		}
	})

	t.Run("local_path source is rejected", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec([]interface{}{
			map[string]interface{}{
				"source": map[string]interface{}{
					"local_path": map[string]interface{}{"path": "/home/me/repo"},
				},
			},
		}))
		want := "task 'review' (agent_call): workspace_entries[0] must use a git_repo source — no client is connected to serve a local_path when a workflow task fires"
		if len(errors) != 1 || errors[0] != want {
			t.Errorf("expected [%q], got %v", want, errors)
		}
	})

	t.Run("missing source is rejected", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec([]interface{}{
			map[string]interface{}{"name": "app"},
		}))
		want := "task 'review' (agent_call): workspace_entries[0] requires a source"
		if len(errors) != 1 || errors[0] != want {
			t.Errorf("expected [%q], got %v", want, errors)
		}
	})

	t.Run("ssh url is rejected", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec([]interface{}{
			map[string]interface{}{
				"source": map[string]interface{}{
					"git_repo": map[string]interface{}{"url": "git@github.com:acme/app.git"},
				},
			},
		}))
		want := "task 'review' (agent_call): workspace_entries[0] url must use HTTPS (e.g. https://github.com/org/repo). SSH URLs are not supported."
		if len(errors) != 1 || errors[0] != want {
			t.Errorf("expected [%q], got %v", want, errors)
		}
	})

	t.Run("second entry's index is reported", func(t *testing.T) {
		errors := ValidateTaskConfigRequiredFields(makeSpec([]interface{}{
			map[string]interface{}{
				"source": map[string]interface{}{
					"git_repo": map[string]interface{}{"url": "https://github.com/acme/app"},
				},
			},
			map[string]interface{}{
				"source": map[string]interface{}{
					"local_path": map[string]interface{}{"path": "/tmp/x"},
				},
			},
		}))
		if len(errors) != 1 || !strings.Contains(errors[0], "workspace_entries[1]") {
			t.Errorf("expected one error naming workspace_entries[1], got %v", errors)
		}
	})
}
