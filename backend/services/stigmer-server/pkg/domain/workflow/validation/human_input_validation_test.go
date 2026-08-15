package validation

import (
	"context"
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"google.golang.org/protobuf/types/known/structpb"
)

func makeHumanInputTask(t *testing.T, name string, config map[string]interface{}) *workflowv1.WorkflowTask {
	t.Helper()
	cfg, err := structpb.NewStruct(config)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return &workflowv1.WorkflowTask{
		Name:       name,
		Kind:       workflowv1.WorkflowTaskKind_human_input,
		TaskConfig: cfg,
	}
}

func makeHumanInputSpec(t *testing.T, tasks ...*workflowv1.WorkflowTask) *workflowv1.WorkflowSpec {
	t.Helper()
	return &workflowv1.WorkflowSpec{
		Document: &workflowv1.WorkflowDocument{
			Dsl:       "1.0.0",
			Namespace: "test",
			Name:      "human-input-policies",
			Version:   "1.0.0",
		},
		Tasks: tasks,
	}
}

func TestValidateHumanInputTimeoutPolicies_RejectsEscalate(t *testing.T) {
	cases := []struct {
		desc      string
		onTimeout interface{}
	}{
		{"enum name", "HUMAN_INPUT_TIMEOUT_ESCALATE"},
		{"numeric enum value", float64(4)},
	}

	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			spec := makeHumanInputSpec(t, makeHumanInputTask(t, "gate", map[string]interface{}{
				"prompt":     "Approve?",
				"timeout":    float64(60),
				"on_timeout": c.onTimeout,
			}))

			errs := ValidateHumanInputTimeoutPolicies(spec)
			if len(errs) != 1 {
				t.Fatalf("expected exactly 1 error, got %v", errs)
			}
			for _, want := range []string{"gate", "HUMAN_INPUT_TIMEOUT_ESCALATE", "not implemented"} {
				if !strings.Contains(errs[0], want) {
					t.Errorf("error should contain %q, got: %s", want, errs[0])
				}
			}
		})
	}
}

func TestValidateHumanInputTimeoutPolicies_AcceptsImplementedPolicies(t *testing.T) {
	for _, policy := range []string{
		"HUMAN_INPUT_TIMEOUT_FAIL",
		"HUMAN_INPUT_TIMEOUT_APPROVE",
		"HUMAN_INPUT_TIMEOUT_DENY",
	} {
		spec := makeHumanInputSpec(t, makeHumanInputTask(t, "gate", map[string]interface{}{
			"prompt":     "Approve?",
			"timeout":    float64(60),
			"on_timeout": policy,
		}))

		if errs := ValidateHumanInputTimeoutPolicies(spec); len(errs) != 0 {
			t.Errorf("policy %s should validate, got errors: %v", policy, errs)
		}
	}
}

func TestValidateHumanInputTimeoutPolicies_IgnoresAbsentPolicyAndOtherKinds(t *testing.T) {
	setVarsCfg, _ := structpb.NewStruct(map[string]interface{}{
		// A set_vars task whose variable VALUE happens to spell the enum name
		// must not trip a rule scoped to human_input's on_timeout field.
		"variables": map[string]interface{}{"note": "HUMAN_INPUT_TIMEOUT_ESCALATE"},
	})
	spec := makeHumanInputSpec(t,
		makeHumanInputTask(t, "gate", map[string]interface{}{"prompt": "Approve?"}),
		&workflowv1.WorkflowTask{
			Name:       "notes",
			Kind:       workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: setVarsCfg,
		},
	)

	if errs := ValidateHumanInputTimeoutPolicies(spec); len(errs) != 0 {
		t.Errorf("expected no errors, got %v", errs)
	}
}

// The validator-level pin: an escalate policy must surface as a user-fixable
// INVALID result (stigmer/stigmer#779 fail-closed ruling), never persist as
// VALID the way it did when only the runner's silent default existed.
func TestInProcessValidator_EscalatePolicyIsInvalid(t *testing.T) {
	spec := makeHumanInputSpec(t, makeHumanInputTask(t, "gate", map[string]interface{}{
		"prompt":     "Approve?",
		"timeout":    float64(60),
		"on_timeout": "HUMAN_INPUT_TIMEOUT_ESCALATE",
	}))

	result, err := NewInProcessValidator().Validate(context.Background(), spec)
	if err != nil {
		t.Fatalf("Validate returned transport error: %v", err)
	}
	if result.State != serverlessv1.ValidationState_INVALID {
		t.Fatalf("expected INVALID, got %v (errors: %v)", result.State, result.Errors)
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e, "not implemented") && strings.Contains(e, "gate") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a not-implemented error naming task 'gate', got: %v", result.Errors)
	}
}
