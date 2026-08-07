package validation

import (
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// The per-task cap comparison mixes two vocabularies deliberately:
// llm_call declares micros natively, agent_call declares the shared
// RunConfig's max_cost_usd (issue #358). These tests pin both the
// conversion arithmetic and the exact warning strings — the cloud Java
// checkBudgetWarnings emits byte-identical strings for the same spec.

func makeBudget(maxCostMicros int64) *workflowv1.WorkflowBudget {
	return &workflowv1.WorkflowBudget{
		MaxCostMicros: maxCostMicros,
		OnExceeded:    workflowv1.BudgetExceededPolicy_budget_exceeded_warn,
	}
}

func makeAgentCallTaskWithCostCap(name string, maxCostUsd float64) *workflowv1.WorkflowTask {
	cfg, _ := structpb.NewStruct(map[string]interface{}{
		"agent":   "test-agent",
		"message": "test message",
		"run_config": map[string]interface{}{
			"max_cost_usd": maxCostUsd,
		},
	})
	return &workflowv1.WorkflowTask{
		Name:       name,
		Kind:       workflowv1.WorkflowTaskKind_agent_call,
		TaskConfig: cfg,
	}
}

func makeLlmCallTaskWithCostCap(name string, maxCostMicros int64) *workflowv1.WorkflowTask {
	cfg, _ := structpb.NewStruct(map[string]interface{}{
		"model":           "some-model",
		"prompt":          "test prompt",
		"max_cost_micros": float64(maxCostMicros),
	})
	return &workflowv1.WorkflowTask{
		Name:       name,
		Kind:       workflowv1.WorkflowTaskKind_llm_call,
		TaskConfig: cfg,
	}
}

func TestCheckBudgetWarnings_AgentCallCapExceedsBudget(t *testing.T) {
	warnings := CheckBudgetWarnings(
		makeBudget(1_000_000),
		[]*workflowv1.WorkflowTask{makeAgentCallTaskWithCostCap("triage", 2.0)},
	)

	want := "Task 'triage' has run_config.max_cost_usd ($2.00) that exceeds the workflow budget max_cost_micros (1000000)."
	if !containsWarning(warnings, want) {
		t.Errorf("expected warning %q, got %v", want, warnings)
	}
}

func TestCheckBudgetWarnings_LlmCallStringUnchanged(t *testing.T) {
	// The llm_call warning predates #358 and its string must not drift.
	warnings := CheckBudgetWarnings(
		makeBudget(1_000_000),
		[]*workflowv1.WorkflowTask{makeLlmCallTaskWithCostCap("gen", 2_000_000)},
	)

	want := "Task 'gen' has max_cost_micros (2000000) that exceeds the workflow budget max_cost_micros (1000000)."
	if !containsWarning(warnings, want) {
		t.Errorf("expected warning %q, got %v", want, warnings)
	}
}

func TestCheckBudgetWarnings_CombinedCapsAcrossVocabularies(t *testing.T) {
	// 600000 micros (llm) + $0.60 (agent) = $1.20 combined vs a $1.00 budget.
	warnings := CheckBudgetWarnings(
		makeBudget(1_000_000),
		[]*workflowv1.WorkflowTask{
			makeLlmCallTaskWithCostCap("gen", 600_000),
			makeAgentCallTaskWithCostCap("triage", 0.6),
		},
	)

	want := "Combined per-task cost limits ($1.20) exceed the workflow budget ($1.00). " +
		"Some tasks may be terminated before reaching their individual limits."
	if !containsWarning(warnings, want) {
		t.Errorf("expected warning %q, got %v", want, warnings)
	}
}

func TestCheckBudgetWarnings_AgentCallCapWithinBudget(t *testing.T) {
	warnings := CheckBudgetWarnings(
		makeBudget(1_000_000),
		[]*workflowv1.WorkflowTask{makeAgentCallTaskWithCostCap("triage", 0.5)},
	)

	for _, w := range warnings {
		if strings.Contains(w, "exceeds the workflow budget") {
			t.Errorf("unexpected over-budget warning for a within-budget cap: %q", w)
		}
	}
}

func TestUsdToMicros_RoundsToNearestMicro(t *testing.T) {
	cases := []struct {
		usd  float64
		want int64
	}{
		{0.5, 500_000},
		{2.0, 2_000_000},
		// 1.005 is not exactly representable in binary; rounding (not
		// truncation) must still land on the intended micro amount.
		{1.005, 1_005_000},
		{0.000001, 1},
	}
	for _, c := range cases {
		if got := usdToMicros(c.usd); got != c.want {
			t.Errorf("usdToMicros(%v) = %d, want %d", c.usd, got, c.want)
		}
	}
}

func containsWarning(warnings []string, want string) bool {
	for _, w := range warnings {
		if w == want {
			return true
		}
	}
	return false
}
