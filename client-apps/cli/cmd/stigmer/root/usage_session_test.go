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
		TotalUsage: &agentexecutionv1.UsageMetrics{
			PromptTokens:     30000,
			CompletionTokens: 5000,
			TotalTokens:      35000,
			EstimatedCostUsd: 0.25,
			CacheReadTokens:  20000,
		},
		ModelBreakdown: []*agentexecutionv1.ModelUsage{
			{
				Model:            "claude-sonnet-4",
				InputTokens:      28000,
				OutputTokens:     4500,
				CacheReadTokens:  20000,
				EstimatedCostUsd: 0.23,
			},
			{
				Model:            "claude-haiku-4",
				InputTokens:      2000,
				OutputTokens:     500,
				CacheReadTokens:  0,
				EstimatedCostUsd: 0.02,
			},
		},
		Executions: []*agentexecutionv1.ExecutionUsageSummary{
			{
				ExecutionId:      "exec_001",
				StartedAt:        "2026-03-10T10:00:00Z",
				PromptTokens:     10000,
				CompletionTokens: 2000,
				EstimatedCostUsd: 0.10,
				PrimaryModel:     "claude-sonnet-4",
				Phase:            agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			},
			{
				ExecutionId:      "exec_002",
				StartedAt:        "2026-03-10T11:00:00Z",
				PromptTokens:     12000,
				CompletionTokens: 1500,
				EstimatedCostUsd: 0.08,
				PrimaryModel:     "claude-sonnet-4",
				Phase:            agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			},
			{
				ExecutionId:      "exec_003",
				StartedAt:        "2026-03-10T12:00:00Z",
				PromptTokens:     8000,
				CompletionTokens: 1500,
				EstimatedCostUsd: 0.07,
				PrimaryModel:     "claude-sonnet-4",
				Phase:            agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
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
				Model:            "gpt-4o",
				InputTokens:      5000,
				OutputTokens:     1000,
				EstimatedCostUsd: 0.05,
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
