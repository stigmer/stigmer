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

// The escalate outcome-by-name contract (stigmer/stigmer#781): the policy is
// only valid when the gate declares an outcome named "escalate" with `then`
// set — the timeout resolves to that outcome and follows its branch.
func TestValidateHumanInputTimeoutPolicies_RejectsEscalateWithoutEscalateOutcome(t *testing.T) {
	cases := []struct {
		desc   string
		config map[string]interface{}
	}{
		{
			desc: "no outcomes at all (enum name)",
			config: map[string]interface{}{
				"prompt":     "Approve?",
				"timeout":    float64(60),
				"on_timeout": "HUMAN_INPUT_TIMEOUT_ESCALATE",
			},
		},
		{
			desc: "no outcomes at all (numeric enum value)",
			config: map[string]interface{}{
				"prompt":     "Approve?",
				"timeout":    float64(60),
				"on_timeout": float64(4),
			},
		},
		{
			desc: "outcomes declared but none named escalate",
			config: map[string]interface{}{
				"prompt":     "Approve?",
				"timeout":    float64(60),
				"on_timeout": "HUMAN_INPUT_TIMEOUT_ESCALATE",
				"outcomes": []interface{}{
					map[string]interface{}{"name": "proceed", "then": "deploy"},
					map[string]interface{}{"name": "reject"},
				},
			},
		},
		{
			desc: "escalate outcome exists but has no then",
			config: map[string]interface{}{
				"prompt":     "Approve?",
				"timeout":    float64(60),
				"on_timeout": "HUMAN_INPUT_TIMEOUT_ESCALATE",
				"outcomes": []interface{}{
					map[string]interface{}{"name": "proceed", "then": "deploy"},
					map[string]interface{}{"name": "escalate"},
				},
			},
		},
	}

	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			spec := makeHumanInputSpec(t, makeHumanInputTask(t, "gate", c.config))

			errs := ValidateHumanInputTimeoutPolicies(spec)
			if len(errs) != 1 {
				t.Fatalf("expected exactly 1 error, got %v", errs)
			}
			for _, want := range []string{"gate", "HUMAN_INPUT_TIMEOUT_ESCALATE", "outcome named 'escalate'", "'then'"} {
				if !strings.Contains(errs[0], want) {
					t.Errorf("error should contain %q, got: %s", want, errs[0])
				}
			}
		})
	}
}

func TestValidateHumanInputTimeoutPolicies_AcceptsEscalateWithDeclaredOutcome(t *testing.T) {
	for _, onTimeout := range []interface{}{"HUMAN_INPUT_TIMEOUT_ESCALATE", float64(4)} {
		spec := makeHumanInputSpec(t, makeHumanInputTask(t, "gate", map[string]interface{}{
			"prompt":     "Approve?",
			"timeout":    float64(60),
			"on_timeout": onTimeout,
			"outcomes": []interface{}{
				map[string]interface{}{"name": "proceed", "then": "deploy"},
				map[string]interface{}{"name": "escalate", "then": "escalationPath"},
				map[string]interface{}{"name": "reject"},
			},
		}))

		if errs := ValidateHumanInputTimeoutPolicies(spec); len(errs) != 0 {
			t.Errorf("escalate (%v) with a declared escalate outcome should validate, got errors: %v", onTimeout, errs)
		}
	}
}

func TestValidateHumanInputTimeoutPolicies_AcceptsPoliciesNeedingNoShape(t *testing.T) {
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

// The validator-level pin: a misconfigured escalate policy (no escalate
// outcome to resolve to) must surface as a user-fixable INVALID result
// (stigmer/stigmer#779's fail-closed posture, carried into #781's shape
// rule), never persist as VALID.
func TestInProcessValidator_EscalateWithoutOutcomeIsInvalid(t *testing.T) {
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
		if strings.Contains(e, "outcome named 'escalate'") && strings.Contains(e, "gate") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a shape error naming task 'gate', got: %v", result.Errors)
	}
}

// The full-validator acceptance twin: a well-shaped escalate gate (escalate
// outcome with `then` routing to a real task) validates end to end — the
// cross-reference layer sees the `then` target and the shape rule is
// satisfied, so the config the runtime can honor persists as VALID.
func TestInProcessValidator_EscalateWithDeclaredOutcomeIsValid(t *testing.T) {
	escalationTaskCfg, err := structpb.NewStruct(map[string]interface{}{
		"variables": map[string]interface{}{"escalated": "true"},
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	spec := makeHumanInputSpec(t,
		makeHumanInputTask(t, "gate", map[string]interface{}{
			"prompt":     "Approve?",
			"timeout":    float64(60),
			"on_timeout": "HUMAN_INPUT_TIMEOUT_ESCALATE",
			"outcomes": []interface{}{
				map[string]interface{}{"name": "proceed"},
				map[string]interface{}{"name": "escalate", "then": "escalationPath"},
			},
		}),
		&workflowv1.WorkflowTask{
			Name:       "escalationPath",
			Kind:       workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: escalationTaskCfg,
		},
	)

	result, err := NewInProcessValidator().Validate(context.Background(), spec)
	if err != nil {
		t.Fatalf("Validate returned transport error: %v", err)
	}
	if result.State != serverlessv1.ValidationState_VALID {
		t.Fatalf("expected VALID, got %v (errors: %v)", result.State, result.Errors)
	}
}
