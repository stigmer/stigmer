package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

func makeExecution(id, sessionID, agentID, org, startedAt string, subAgents []*agentexecutionv1.SubAgentExecution) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: "exec-" + id,
			Org:  org,
		},
		Spec: &agentexecutionv1.AgentExecutionSpec{
			SessionId: sessionID,
			AgentId:   agentID,
		},
		Status: &agentexecutionv1.AgentExecutionStatus{
			StartedAt:          startedAt,
			CompletedAt:        startedAt,
			Phase:              agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			SubAgentExecutions: subAgents,
		},
	}
}

func TestAggregateUsageReport_ReturnsZero(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z", nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T11:00:00Z", nil),
	}

	agg := aggregateUsageReport(executions)

	if agg.InputTokens != 0 {
		t.Errorf("InputTokens = %d, want 0", agg.InputTokens)
	}
	if agg.OutputTokens != 0 {
		t.Errorf("OutputTokens = %d, want 0", agg.OutputTokens)
	}
	if agg.TotalTokens != 0 {
		t.Errorf("TotalTokens = %d, want 0", agg.TotalTokens)
	}
	if agg.LlmCallCount != 0 {
		t.Errorf("LlmCallCount = %d, want 0", agg.LlmCallCount)
	}
	if agg.BillableCostMicros != 0 {
		t.Errorf("BillableCostMicros = %d, want 0", agg.BillableCostMicros)
	}
}

func TestMergeModelBreakdowns_ReturnsEmpty(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z", nil),
	}

	merged := mergeModelBreakdowns(executions)
	if len(merged) != 0 {
		t.Errorf("expected 0 merged entries, got %d", len(merged))
	}
}

func TestBuildExecutionSummary(t *testing.T) {
	exec := makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z",
		[]*agentexecutionv1.SubAgentExecution{{}},
	)

	summary := buildExecutionSummary(exec)

	if summary.ExecutionId != "e1" {
		t.Errorf("ExecutionId = %s, want e1", summary.ExecutionId)
	}
	if summary.StartedAt != "2026-03-10T10:00:00Z" {
		t.Errorf("StartedAt = %s, want 2026-03-10T10:00:00Z", summary.StartedAt)
	}
	if summary.SubAgentCount != 1 {
		t.Errorf("SubAgentCount = %d, want 1", summary.SubAgentCount)
	}
	if summary.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
		t.Errorf("Phase = %v, want EXECUTION_COMPLETED", summary.Phase)
	}
	if summary.InputTokens != 0 {
		t.Errorf("InputTokens = %d, want 0 (OSS has no usage data)", summary.InputTokens)
	}
	if summary.BillableCostMicros != 0 {
		t.Errorf("BillableCostMicros = %d, want 0 (OSS has no usage data)", summary.BillableCostMicros)
	}
}

func TestFilterByDateRange(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-01T10:00:00Z", nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-05T10:00:00Z", nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-10T10:00:00Z", nil),
		makeExecution("e4", "s1", "a1", "org", "2026-03-15T10:00:00Z", nil),
	}

	t.Run("both bounds", func(t *testing.T) {
		filtered := filterByDateRange(executions, "2026-03-03", "2026-03-12")
		if len(filtered) != 2 {
			t.Errorf("expected 2 executions, got %d", len(filtered))
		}
	})

	t.Run("from only", func(t *testing.T) {
		filtered := filterByDateRange(executions, "2026-03-10", "")
		if len(filtered) != 2 {
			t.Errorf("expected 2 executions, got %d", len(filtered))
		}
	})

	t.Run("to only", func(t *testing.T) {
		filtered := filterByDateRange(executions, "", "2026-03-05T10:00:00Z")
		if len(filtered) != 2 {
			t.Errorf("expected 2 executions, got %d", len(filtered))
		}
	})

	t.Run("no bounds", func(t *testing.T) {
		filtered := filterByDateRange(executions, "", "")
		if len(filtered) != 4 {
			t.Errorf("expected 4 executions, got %d", len(filtered))
		}
	})
}

func TestGroupBySessionID(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "", nil),
		makeExecution("e2", "s1", "a1", "org", "", nil),
		makeExecution("e3", "s2", "a1", "org", "", nil),
	}

	groups := groupBySessionID(executions)
	if len(groups) != 2 {
		t.Errorf("expected 2 groups, got %d", len(groups))
	}
	if len(groups["s1"]) != 2 {
		t.Errorf("s1 group size = %d, want 2", len(groups["s1"]))
	}
	if len(groups["s2"]) != 1 {
		t.Errorf("s2 group size = %d, want 1", len(groups["s2"]))
	}
}

func TestGroupByDate(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z", nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z", nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-11T09:00:00Z", nil),
	}

	groups := groupByDate(executions)
	if len(groups) != 2 {
		t.Errorf("expected 2 date groups, got %d", len(groups))
	}
	if len(groups["2026-03-10"]) != 2 {
		t.Errorf("2026-03-10 group size = %d, want 2", len(groups["2026-03-10"]))
	}
}

func TestBuildSessionSummary(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z", nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z", nil),
	}

	summary := buildSessionSummary("s1", executions)

	if summary.SessionId != "s1" {
		t.Errorf("SessionId = %s, want s1", summary.SessionId)
	}
	if summary.ExecutionCount != 2 {
		t.Errorf("ExecutionCount = %d, want 2", summary.ExecutionCount)
	}
	if summary.TotalTokens != 0 {
		t.Errorf("TotalTokens = %d, want 0 (OSS has no usage data)", summary.TotalTokens)
	}
	if summary.BillableCostMicros != 0 {
		t.Errorf("BillableCostMicros = %d, want 0 (OSS has no usage data)", summary.BillableCostMicros)
	}
	if summary.FirstExecutionAt != "2026-03-10T08:00:00Z" {
		t.Errorf("FirstExecutionAt = %s, want 2026-03-10T08:00:00Z", summary.FirstExecutionAt)
	}
}

func TestBuildDailyCostEntries(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z", nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z", nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-11T09:00:00Z", nil),
	}

	entries := buildDailyCostEntries(executions)

	if len(entries) != 2 {
		t.Fatalf("expected 2 daily entries, got %d", len(entries))
	}
	if entries[0].Date != "2026-03-10" {
		t.Errorf("first entry date = %s, want 2026-03-10", entries[0].Date)
	}
	if entries[0].ExecutionCount != 2 {
		t.Errorf("2026-03-10 execution count = %d, want 2", entries[0].ExecutionCount)
	}
	if entries[0].TotalTokens != 0 {
		t.Errorf("2026-03-10 tokens = %d, want 0 (OSS has no usage data)", entries[0].TotalTokens)
	}
	if entries[1].Date != "2026-03-11" {
		t.Errorf("second entry date = %s, want 2026-03-11", entries[1].Date)
	}
}

func TestTopAgentsByCost(t *testing.T) {
	summaries := []*agentexecutionv1.AgentUsageSummary{
		{AgentId: "a1", BillableCostMicros: 1_000_000},
		{AgentId: "a2", BillableCostMicros: 5_000_000},
		{AgentId: "a3", BillableCostMicros: 500_000},
		{AgentId: "a4", BillableCostMicros: 3_000_000},
	}

	top := topAgentsByCost(summaries, 2)
	if len(top) != 2 {
		t.Fatalf("expected 2 results, got %d", len(top))
	}
	if top[0].AgentId != "a2" {
		t.Errorf("top[0] = %s, want a2", top[0].AgentId)
	}
	if top[1].AgentId != "a4" {
		t.Errorf("top[1] = %s, want a4", top[1].AgentId)
	}
}

func TestFilterByOrg(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org-a", "", nil),
		makeExecution("e2", "s1", "a1", "org-b", "", nil),
		makeExecution("e3", "s1", "a1", "org-a", "", nil),
	}

	filtered := filterByOrg(executions, "org-a")
	if len(filtered) != 2 {
		t.Errorf("expected 2 executions, got %d", len(filtered))
	}
}

func TestExtractDate(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"2026-03-10T08:00:00Z", "2026-03-10"},
		{"2026-03-10", "2026-03-10"},
		{"short", ""},
		{"", ""},
	}
	for _, tt := range tests {
		got := extractDate(tt.input)
		if got != tt.want {
			t.Errorf("extractDate(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestEarliestAndLatestStartedAt(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T14:00:00Z", nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-05T09:00:00Z", nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-12T08:00:00Z", nil),
	}

	if got := earliestStartedAt(executions); got != "2026-03-05T09:00:00Z" {
		t.Errorf("earliest = %s, want 2026-03-05T09:00:00Z", got)
	}
	if got := latestStartedAt(executions); got != "2026-03-12T08:00:00Z" {
		t.Errorf("latest = %s, want 2026-03-12T08:00:00Z", got)
	}
}

func TestEmptyInputs(t *testing.T) {
	var empty []*agentexecutionv1.AgentExecution

	agg := aggregateUsageReport(empty)
	if agg.TotalTokens != 0 {
		t.Errorf("expected 0 total tokens for empty input, got %d", agg.TotalTokens)
	}

	merged := mergeModelBreakdowns(empty)
	if len(merged) != 0 {
		t.Errorf("expected 0 merged entries for empty input, got %d", len(merged))
	}

	entries := buildDailyCostEntries(empty)
	if len(entries) != 0 {
		t.Errorf("expected 0 daily entries for empty input, got %d", len(entries))
	}

	if got := earliestStartedAt(empty); got != "" {
		t.Errorf("expected empty earliest for empty input, got %s", got)
	}
}
