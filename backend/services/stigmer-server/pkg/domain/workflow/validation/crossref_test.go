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
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": 1}}
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
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": 1}}
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
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": 1}}
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
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": 1}}
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
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": 1}}
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
	cfg := map[string]interface{}{"variables": map[string]interface{}{"x": 1}}
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
