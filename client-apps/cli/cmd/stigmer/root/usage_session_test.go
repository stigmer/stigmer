package root

import (
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

func TestRenderSessionUsageTable_BasicReport(t *testing.T) {
	report := &agentexecutionv1.GetSessionUsageReportOutput{
		SessionId:        "ses_abc123",
		ExecutionCount:   3,
		FirstExecutionAt: "2026-03-10T10:00:00Z",
		LastExecutionAt:  "2026-03-10T12:00:00Z",
		TotalUsage: &agentexecutionv1.UsageReportAggregate{
			InputTokens:          30000,
			OutputTokens:         5000,
			TotalTokens:          35000,
			BillableCostMicros:   250_000,
			CacheReadInputTokens: 20000,
		},
		ModelBreakdown: []*agentexecutionv1.ModelUsage{
			{
				Model:                "claude-sonnet-4",
				InputTokens:          28000,
				OutputTokens:         4500,
				CacheReadInputTokens: 20000,
				BillableCostMicros:   230_000,
			},
			{
				Model:                "claude-haiku-4",
				InputTokens:          2000,
				OutputTokens:         500,
				CacheReadInputTokens: 0,
				BillableCostMicros:   20_000,
			},
		},
		Executions: []*agentexecutionv1.ExecutionUsageSummary{
			{
				ExecutionId:        "exec_001",
				StartedAt:          "2026-03-10T10:00:00Z",
				InputTokens:        10000,
				OutputTokens:       2000,
				BillableCostMicros: 100_000,
				PrimaryModel:       "claude-sonnet-4",
				Phase:              agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			},
			{
				ExecutionId:        "exec_002",
				StartedAt:          "2026-03-10T11:00:00Z",
				InputTokens:        12000,
				OutputTokens:       1500,
				BillableCostMicros: 80_000,
				PrimaryModel:       "claude-sonnet-4",
				Phase:              agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			},
			{
				ExecutionId:        "exec_003",
				StartedAt:          "2026-03-10T12:00:00Z",
				InputTokens:        8000,
				OutputTokens:       1500,
				BillableCostMicros: 70_000,
				PrimaryModel:       "claude-sonnet-4",
				Phase:              agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			},
		},
	}

	output := captureStdout(t, func() {
		renderSessionUsageTable(report)
	})

	if !strings.Contains(output, "ses_abc123") {
		t.Error("expected session ID in output")
	}
	if !strings.Contains(output, "3 executions") {
		t.Error("expected execution count in output")
	}
	if !strings.Contains(output, "claude-sonnet-4") {
		t.Error("expected model name in output")
	}
	if !strings.Contains(output, "claude-haiku-4") {
		t.Error("expected second model in output")
	}
	if !strings.Contains(output, "Total") {
		t.Error("expected Total row when multiple models")
	}
	if !strings.Contains(output, "67% cached") {
		t.Error("expected cache hit rate in output")
	}
	if !strings.Contains(output, "completed") {
		t.Error("expected execution status in output")
	}
}

func TestRenderSessionUsageTable_EmptyReport(t *testing.T) {
	report := &agentexecutionv1.GetSessionUsageReportOutput{
		SessionId:      "ses_empty",
		ExecutionCount: 0,
	}

	output := captureStdout(t, func() {
		renderSessionUsageTable(report)
	})

	if !strings.Contains(output, "ses_empty") {
		t.Error("expected session ID in output")
	}
}

func TestRenderSessionUsageTable_SingleModel(t *testing.T) {
	report := &agentexecutionv1.GetSessionUsageReportOutput{
		SessionId:      "ses_single",
		ExecutionCount: 1,
		ModelBreakdown: []*agentexecutionv1.ModelUsage{
			{
				Model:              "gpt-4o",
				InputTokens:        5000,
				OutputTokens:       1000,
				BillableCostMicros: 50_000,
			},
		},
	}

	output := captureStdout(t, func() {
		renderSessionUsageTable(report)
	})

	if strings.Contains(output, "Total") {
		t.Error("expected no Total row for single model")
	}
}
