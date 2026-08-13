package main

import (
	"strings"
	"testing"
)

// mustBuildRegistriesWithRules arms the protovalidate pass in the given mode
// on a fresh registry set — the rule-pass twin of mustBuildRegistries.
func mustBuildRegistriesWithRules(t *testing.T, mode docsYamlRuleMode) *docsYamlRegistries {
	t.Helper()
	reg := mustBuildRegistries(t)
	rules, err := newDocsYamlRuleEval(mode)
	if err != nil {
		t.Fatalf("newDocsYamlRuleEval(%s): %v", mode, err)
	}
	reg.rules = rules
	return reg
}

// fenceAt wraps a YAML body as the codeFence the classifier consumes.
func fenceAt(meta, body string) codeFence {
	return codeFence{Path: "docs/fixture.mdx", Line: 7, Lang: "yaml", Meta: meta, Body: body}
}

func TestParseDocsYamlRuleMode(t *testing.T) {
	for _, valid := range []string{"off", "report", "enforce"} {
		if _, err := parseDocsYamlRuleMode(valid); err != nil {
			t.Errorf("parseDocsYamlRuleMode(%q): unexpected error %v", valid, err)
		}
	}
	if _, err := parseDocsYamlRuleMode("audit"); err == nil {
		t.Error("parseDocsYamlRuleMode(\"audit\"): expected an error")
	}
}

func TestRuleFamilyBuckets(t *testing.T) {
	cases := map[string]string{
		"required":           "required",
		"string.in":          "in-list",
		"enum.in":            "in-list",
		"enum.not_in":        "in-list",
		"enum.defined_only":  "in-list",
		"string.min_len":     "other",
		"repeated.min_items": "other",
		"string.pattern":     "other",
		"custom_cel_rule":    "other",
	}
	for id, want := range cases {
		if got := ruleFamily(id); got != want {
			t.Errorf("ruleFamily(%q) = %q, want %q", id, got, want)
		}
	}
}

// A Workflow manifest that decodes cleanly but elides fields the contract
// marks required (metadata, spec.document) — the shape rule evaluation
// exists to catch and plain strict decoding cannot.
const ruleTestManifestElidingRequired = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
spec:
  tasks:
    - name: pause
      kind: wait
      task_config:
        duration:
          seconds: 30
`

// A task list whose nested task_config violates rules that live on the typed
// variant message (TransformTaskConfig.expression is required) — invisible
// from the parent WorkflowTask, whose task_config field is an opaque Struct.
// This is the recursion-level evaluation the top-level pass would miss.
const ruleTestTaskListNestedViolation = `- name: reshape
  kind: transform
  task_config:
    engine: TRANSFORM_ENGINE_JQ
`

func TestRuleEvaluationEnforceMode(t *testing.T) {
	reg := mustBuildRegistriesWithRules(t, ruleModeEnforce)

	t.Run("manifest eliding required fields fails", func(t *testing.T) {
		class, problems := classifyAndValidateFence(fenceAt("", ruleTestManifestElidingRequired), reg)
		if class != blockInvalid {
			t.Fatalf("class = %v, want blockInvalid", class)
		}
		joined := strings.Join(problems, "\n")
		if !strings.Contains(joined, "(rule: required)") {
			t.Errorf("expected a required-rule problem, got:\n%s", joined)
		}
	})

	t.Run("rule violations inside a typed task_config fail (recursion-level evaluation)", func(t *testing.T) {
		class, problems := classifyAndValidateFence(fenceAt("", ruleTestTaskListNestedViolation), reg)
		if class != blockInvalid {
			t.Fatalf("class = %v, want blockInvalid", class)
		}
		joined := strings.Join(problems, "\n")
		if !strings.Contains(joined, "expression") || !strings.Contains(joined, "(rule:") {
			t.Errorf("expected a rule problem on TransformTaskConfig.expression, got:\n%s", joined)
		}
	})

	t.Run("anchored fragments are never rule-evaluated", func(t *testing.T) {
		// The same elision that fails as a task list is legitimate as an
		// anchored fragment: partial instances are the anchor contract.
		class, problems := classifyAndValidateFence(
			fenceAt(`validate-as="task-config:transform"`, "engine: TRANSFORM_ENGINE_JQ\n"), reg)
		if class != blockAnchored || len(problems) != 0 {
			t.Errorf("anchored fragment: class = %v, problems = %v; want blockAnchored with none", class, problems)
		}
	})

	t.Run("a rule-satisfying block still passes", func(t *testing.T) {
		body := `- name: reshape
  kind: transform
  task_config:
    engine: TRANSFORM_ENGINE_JQ
    expression: "{name: .full_name}"
`
		class, problems := classifyAndValidateFence(fenceAt("", body), reg)
		if class != blockTaskList || len(problems) != 0 {
			t.Errorf("class = %v, problems = %v; want blockTaskList with none", class, problems)
		}
	})
}

func TestRuleEvaluationReportMode(t *testing.T) {
	reg := mustBuildRegistriesWithRules(t, ruleModeReport)

	class, problems := classifyAndValidateFence(fenceAt("", ruleTestManifestElidingRequired), reg)
	if class != blockManifest || len(problems) != 0 {
		t.Fatalf("report mode must not fail the block: class = %v, problems = %v", class, problems)
	}
	if len(reg.rules.violations) == 0 {
		t.Fatal("report mode recorded no violations for a required-eliding manifest")
	}
	v := reg.rules.violations[0]
	if v.Path != "docs/fixture.mdx" || v.Line != 7 || v.BlockClass != "manifest" {
		t.Errorf("violation location/context = %+v, want docs/fixture.mdx:7 [manifest]", v)
	}
	sawRequired := false
	for _, f := range reg.rules.violations {
		if f.RuleID == "required" {
			sawRequired = true
		}
	}
	if !sawRequired {
		t.Errorf("expected a required violation, got: %+v", reg.rules.violations)
	}
}

func TestRuleEvaluationOffModeIsNilSafe(t *testing.T) {
	reg := mustBuildRegistries(t) // reg.rules stays nil — the off mode
	class, problems := classifyAndValidateFence(fenceAt("", ruleTestManifestElidingRequired), reg)
	if class != blockManifest || len(problems) != 0 {
		t.Errorf("off mode must match pre-rules behavior: class = %v, problems = %v", class, problems)
	}
}
