package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

func makeAIMessage(inputTokens, outputTokens, cacheCreation, cacheRead int32, cost float64, model, provider string) *agentexecutionv1.AgentMessage {
	return &agentexecutionv1.AgentMessage{
		Type: agentexecutionv1.MessageType_MESSAGE_AI,
		LlmMetrics: &agentexecutionv1.LlmCallMetrics{
			InputTokens:         inputTokens,
			OutputTokens:        outputTokens,
			CacheCreationTokens: cacheCreation,
			CacheReadTokens:     cacheRead,
			EstimatedCostUsd:    cost,
			Model:               model,
			Provider:            provider,
		},
	}
}

func makeExecution(id, sessionID, agentID, org, startedAt string, messages []*agentexecutionv1.AgentMessage, subAgents []*agentexecutionv1.SubAgentExecution, contextInfo *agentexecutionv1.ContextInfo) *agentexecutionv1.AgentExecution {
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
			Messages:           messages,
			SubAgentExecutions: subAgents,
			ContextInfo:        contextInfo,
		},
	}
}

func TestExecutionTotalCost(t *testing.T) {
	exec := makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z",
		[]*agentexecutionv1.AgentMessage{
			makeAIMessage(50, 25, 0, 0, 0.05, "claude-sonnet-4", "anthropic"),
			makeAIMessage(50, 25, 0, 0, 0.05, "claude-sonnet-4", "anthropic"),
		},
		[]*agentexecutionv1.SubAgentExecution{
			{Messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(20, 10, 0, 0, 0.02, "claude-haiku-4", "anthropic"),
			}},
			{Messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(30, 15, 0, 0, 0.03, "claude-haiku-4", "anthropic"),
			}},
		},
		nil,
	)

	got := executionTotalCost(exec)
	want := 0.15
	if !floatEq(got, want) {
		t.Errorf("executionTotalCost = %f, want %f", got, want)
	}
}

func TestExecutionTotalCost_NilUsage(t *testing.T) {
	exec := makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z", nil, nil, nil)
	got := executionTotalCost(exec)
	if got != 0 {
		t.Errorf("executionTotalCost for nil usage = %f, want 0", got)
	}
}

func TestExecutionTotalSummarizationCost(t *testing.T) {
	exec := makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z",
		[]*agentexecutionv1.AgentMessage{
			makeAIMessage(50, 25, 0, 0, 0.05, "claude-sonnet-4", "anthropic"),
			makeAIMessage(50, 25, 0, 0, 0.05, "claude-sonnet-4", "anthropic"),
		},
		nil,
		&agentexecutionv1.ContextInfo{
			SummarizationEvents: []*agentexecutionv1.SummarizationEvent{
				{SummarizationCostUsd: 0.001},
				{SummarizationCostUsd: 0.002},
			},
		},
	)

	got := executionTotalSummarizationCost(exec)
	want := 0.003
	if !floatEq(got, want) {
		t.Errorf("executionTotalSummarizationCost = %f, want %f", got, want)
	}
}

func TestAggregateUsageMetrics(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(300, 150, 0, 0, 0.04, "claude-sonnet-4", "anthropic"),
				makeAIMessage(300, 150, 0, 0, 0.04, "claude-sonnet-4", "anthropic"),
				makeAIMessage(300, 150, 0, 0, 0.04, "claude-sonnet-4", "anthropic"),
			},
			[]*agentexecutionv1.SubAgentExecution{
				{Messages: []*agentexecutionv1.AgentMessage{
					makeAIMessage(200, 100, 0, 0, 0.02, "claude-haiku-4", "anthropic"),
				}},
			},
			nil,
		),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T11:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(450, 225, 0, 0, 0.03, "claude-sonnet-4", "anthropic"),
				makeAIMessage(450, 225, 0, 0, 0.03, "claude-sonnet-4", "anthropic"),
			},
			nil,
			nil,
		),
	}

	agg := aggregateUsageMetrics(executions)

	if agg.PromptTokens != 2000 {
		t.Errorf("PromptTokens = %d, want 2000", agg.PromptTokens)
	}
	if agg.CompletionTokens != 1000 {
		t.Errorf("CompletionTokens = %d, want 1000", agg.CompletionTokens)
	}
	if agg.TotalTokens != 3000 {
		t.Errorf("TotalTokens = %d, want 3000", agg.TotalTokens)
	}
	if agg.LlmCallCount != 6 {
		t.Errorf("LlmCallCount = %d, want 6", agg.LlmCallCount)
	}
	if !floatEq(agg.EstimatedCostUsd, 0.20) {
		t.Errorf("EstimatedCostUsd = %f, want 0.20", agg.EstimatedCostUsd)
	}
}

func TestMergeModelBreakdowns(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(250, 100, 0, 50, 0.025, "claude-sonnet-4", "anthropic"),
				makeAIMessage(250, 100, 0, 50, 0.025, "claude-sonnet-4", "anthropic"),
				makeAIMessage(100, 50, 0, 0, 0.01, "claude-haiku-4", "anthropic"),
			},
			nil, nil,
		),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T11:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(300, 150, 0, 80, 0.03, "claude-sonnet-4", "anthropic"),
			},
			nil, nil,
		),
	}

	merged := mergeModelBreakdowns(executions)

	if len(merged) != 2 {
		t.Fatalf("expected 2 merged entries, got %d", len(merged))
	}

	sonnet := merged[0]
	if sonnet.GetModel() != "claude-sonnet-4" {
		t.Errorf("first entry model = %s, want claude-sonnet-4", sonnet.GetModel())
	}
	if sonnet.GetInputTokens() != 800 {
		t.Errorf("sonnet InputTokens = %d, want 800", sonnet.GetInputTokens())
	}
	if sonnet.GetOutputTokens() != 350 {
		t.Errorf("sonnet OutputTokens = %d, want 350", sonnet.GetOutputTokens())
	}
	if sonnet.GetCacheReadTokens() != 180 {
		t.Errorf("sonnet CacheReadTokens = %d, want 180", sonnet.GetCacheReadTokens())
	}
	if sonnet.GetCallCount() != 3 {
		t.Errorf("sonnet CallCount = %d, want 3", sonnet.GetCallCount())
	}
	if !floatEq(sonnet.GetEstimatedCostUsd(), 0.08) {
		t.Errorf("sonnet cost = %f, want 0.08", sonnet.GetEstimatedCostUsd())
	}
}

func TestBuildExecutionSummary(t *testing.T) {
	exec := makeExecution("e1", "s1", "a1", "org", "2026-03-10T10:00:00Z",
		[]*agentexecutionv1.AgentMessage{
			makeAIMessage(800, 300, 0, 0, 0.10, "claude-sonnet-4", "anthropic"),
		},
		[]*agentexecutionv1.SubAgentExecution{
			{Messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(200, 100, 0, 0, 0.02, "claude-haiku-4", "anthropic"),
			}},
		},
		nil,
	)

	summary := buildExecutionSummary(exec)

	if summary.ExecutionId != "e1" {
		t.Errorf("ExecutionId = %s, want e1", summary.ExecutionId)
	}
	if summary.PromptTokens != 1000 {
		t.Errorf("PromptTokens = %d, want 1000", summary.PromptTokens)
	}
	if !floatEq(summary.EstimatedCostUsd, 0.12) {
		t.Errorf("EstimatedCostUsd = %f, want 0.12", summary.EstimatedCostUsd)
	}
	if summary.SubAgentCount != 1 {
		t.Errorf("SubAgentCount = %d, want 1", summary.SubAgentCount)
	}
	if summary.PrimaryModel != "claude-sonnet-4" {
		t.Errorf("PrimaryModel = %s, want claude-sonnet-4", summary.PrimaryModel)
	}
}

func TestFilterByDateRange(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-01T10:00:00Z", nil, nil, nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-05T10:00:00Z", nil, nil, nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-10T10:00:00Z", nil, nil, nil),
		makeExecution("e4", "s1", "a1", "org", "2026-03-15T10:00:00Z", nil, nil, nil),
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
		makeExecution("e1", "s1", "a1", "org", "", nil, nil, nil),
		makeExecution("e2", "s1", "a1", "org", "", nil, nil, nil),
		makeExecution("e3", "s2", "a1", "org", "", nil, nil, nil),
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
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z", nil, nil, nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z", nil, nil, nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-11T09:00:00Z", nil, nil, nil),
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
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(1000, 500, 0, 0, 0.10, "claude-sonnet-4", "anthropic"),
			},
			nil, nil,
		),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(800, 400, 0, 0, 0.08, "claude-sonnet-4", "anthropic"),
			},
			nil, nil,
		),
	}

	summary := buildSessionSummary("s1", executions)

	if summary.SessionId != "s1" {
		t.Errorf("SessionId = %s, want s1", summary.SessionId)
	}
	if summary.ExecutionCount != 2 {
		t.Errorf("ExecutionCount = %d, want 2", summary.ExecutionCount)
	}
	if summary.TotalTokens != 2700 {
		t.Errorf("TotalTokens = %d, want 2700", summary.TotalTokens)
	}
	if !floatEq(summary.EstimatedCostUsd, 0.18) {
		t.Errorf("EstimatedCostUsd = %f, want 0.18", summary.EstimatedCostUsd)
	}
	if summary.FirstExecutionAt != "2026-03-10T08:00:00Z" {
		t.Errorf("FirstExecutionAt = %s, want 2026-03-10T08:00:00Z", summary.FirstExecutionAt)
	}
}

func TestBuildDailyCostEntries(t *testing.T) {
	executions := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T08:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(500, 500, 0, 0, 0.05, "", ""),
			},
			nil, nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-10T14:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(1000, 1000, 0, 0, 0.10, "", ""),
			},
			nil, nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-11T09:00:00Z",
			[]*agentexecutionv1.AgentMessage{
				makeAIMessage(250, 250, 0, 0, 0.03, "", ""),
			},
			nil, nil),
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
	if entries[0].TotalTokens != 3000 {
		t.Errorf("2026-03-10 tokens = %d, want 3000", entries[0].TotalTokens)
	}
	if !floatEq(entries[0].EstimatedCostUsd, 0.15) {
		t.Errorf("2026-03-10 cost = %f, want 0.15", entries[0].EstimatedCostUsd)
	}
	if entries[1].Date != "2026-03-11" {
		t.Errorf("second entry date = %s, want 2026-03-11", entries[1].Date)
	}
}

func TestTopAgentsByCost(t *testing.T) {
	summaries := []*agentexecutionv1.AgentUsageSummary{
		{AgentId: "a1", EstimatedCostUsd: 1.00},
		{AgentId: "a2", EstimatedCostUsd: 5.00},
		{AgentId: "a3", EstimatedCostUsd: 0.50},
		{AgentId: "a4", EstimatedCostUsd: 3.00},
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
		makeExecution("e1", "s1", "a1", "org-a", "", nil, nil, nil),
		makeExecution("e2", "s1", "a1", "org-b", "", nil, nil, nil),
		makeExecution("e3", "s1", "a1", "org-a", "", nil, nil, nil),
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
		makeExecution("e1", "s1", "a1", "org", "2026-03-10T14:00:00Z", nil, nil, nil),
		makeExecution("e2", "s1", "a1", "org", "2026-03-05T09:00:00Z", nil, nil, nil),
		makeExecution("e3", "s1", "a1", "org", "2026-03-12T08:00:00Z", nil, nil, nil),
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

	agg := aggregateUsageMetrics(empty)
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

const floatTolerance = 1e-9

func floatEq(a, b float64) bool {
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	return diff < floatTolerance
}
