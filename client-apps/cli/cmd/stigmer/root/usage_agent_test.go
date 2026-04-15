package root

import (
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

func TestRenderAgentUsageTable_BasicReport(t *testing.T) {
	report := &agentexecutionv1.GetAgentUsageReportOutput{
		AgentId:         "agt_abc",
		AgentName:       "my-coding-assistant",
		TotalSessions:   8,
		TotalExecutions: 47,
		TotalCostUsd:    4.12,
		ModelBreakdown: []*agentexecutionv1.ModelUsage{
			{
				Model:            "claude-sonnet-4",
				InputTokens:      800000,
				OutputTokens:     45000,
				EstimatedCostUsd: 4.02,
			},
			{
				Model:            "claude-haiku-4",
				InputTokens:      45000,
				OutputTokens:     2400,
				EstimatedCostUsd: 0.10,
			},
		},
		Sessions: []*agentexecutionv1.SessionUsageSummary{
			{
				SessionId:        "ses_001",
				ExecutionCount:   6,
				EstimatedCostUsd: 0.52,
				FirstExecutionAt: "2026-03-01T10:00:00Z",
				LastExecutionAt:  "2026-03-01T15:00:00Z",
			},
			{
				SessionId:        "ses_002",
				ExecutionCount:   4,
				EstimatedCostUsd: 0.41,
				FirstExecutionAt: "2026-03-02T09:00:00Z",
				LastExecutionAt:  "2026-03-03T11:00:00Z",
			},
		},
	}

	output := captureStdout(t, func() {
		renderAgentUsageTable(report, "2026-03-01", "2026-03-13")
	})

	if !strings.Contains(output, "my-coding-assistant") {
		t.Error("expected agent name in output")
	}
	if !strings.Contains(output, "2026-03-01 to 2026-03-13") {
		t.Error("expected date range in output")
	}
	if !strings.Contains(output, "Sessions:     8") {
		t.Error("expected session count in output")
	}
	if !strings.Contains(output, "Executions:   47") {
		t.Error("expected execution count in output")
	}
	if !strings.Contains(output, "$4.12") {
		t.Error("expected total cost in output")
	}
	if !strings.Contains(output, "claude-sonnet-4") {
		t.Error("expected model name in output")
	}
	if !strings.Contains(output, "97.6%") {
		t.Error("expected cost share percentage in output")
	}
}

func TestRenderAgentUsageTable_FallsBackToAgentID(t *testing.T) {
	report := &agentexecutionv1.GetAgentUsageReportOutput{
		AgentId:         "agt_xyz",
		TotalExecutions: 1,
		TotalCostUsd:    0.05,
	}

	output := captureStdout(t, func() {
		renderAgentUsageTable(report, "", "")
	})

	if !strings.Contains(output, "agt_xyz") {
		t.Error("expected agent ID as fallback when name is empty")
	}
	if strings.Contains(output, "Period:") {
		t.Error("expected no Period line when dates are empty")
	}
}

func TestFormatInputDateRange_BothPresent(t *testing.T) {
	if got := formatInputDateRange("2026-03-01", "2026-03-13"); got != "2026-03-01 to 2026-03-13" {
		t.Errorf("formatInputDateRange(both) = %q", got)
	}
}

func TestFormatInputDateRange_OnlyFrom(t *testing.T) {
	if got := formatInputDateRange("2026-03-01", ""); got != "from 2026-03-01" {
		t.Errorf("formatInputDateRange(from only) = %q", got)
	}
}

func TestFormatInputDateRange_OnlyTo(t *testing.T) {
	if got := formatInputDateRange("", "2026-03-13"); got != "to 2026-03-13" {
		t.Errorf("formatInputDateRange(to only) = %q", got)
	}
}

func TestFormatInputDateRange_BothEmpty(t *testing.T) {
	if got := formatInputDateRange("", ""); got != "" {
		t.Errorf("formatInputDateRange(empty) = %q, want empty", got)
	}
}
