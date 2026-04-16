package root

import (
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

func TestRenderOrgUsageTable_FullReport(t *testing.T) {
	report := &agentexecutionv1.GetOrgUsageReportOutput{
		OrgId:           "org_acme",
		TotalAgents:     12,
		TotalSessions:   34,
		TotalExecutions: 187,
		TotalCostUsd:    18.42,
		ModelBreakdown: []*agentexecutionv1.ModelUsage{
			{
				Model:            "claude-sonnet-4",
				InputTokens:      3000000,
				OutputTokens:     245000,
				EstimatedCostUsd: 16.80,
			},
			{
				Model:            "gpt-4o",
				InputTokens:      450000,
				OutputTokens:     35000,
				EstimatedCostUsd: 1.20,
			},
			{
				Model:            "claude-haiku-4",
				InputTokens:      300000,
				OutputTokens:     12000,
				EstimatedCostUsd: 0.42,
			},
		},
		TopAgentsByCost: []*agentexecutionv1.AgentUsageSummary{
			{
				AgentId:          "agt_001",
				AgentName:        "cloud-resource-assistant",
				ExecutionCount:   52,
				EstimatedCostUsd: 5.20,
			},
			{
				AgentId:          "agt_002",
				AgentName:        "code-reviewer",
				ExecutionCount:   38,
				EstimatedCostUsd: 3.80,
			},
		},
		DailyCosts: []*agentexecutionv1.DailyCostEntry{
			{Date: "2026-03-01", ExecutionCount: 14, EstimatedCostUsd: 1.42},
			{Date: "2026-03-02", ExecutionCount: 12, EstimatedCostUsd: 1.18},
		},
	}

	output := captureStdout(t, func() {
		renderOrgUsageTable(report, "2026-03-01", "2026-03-13")
	})

	if !strings.Contains(output, "Organization Usage Report") {
		t.Error("expected report title")
	}
	if !strings.Contains(output, "Agents:       12") {
		t.Error("expected agent count")
	}
	if !strings.Contains(output, "Executions:   187") {
		t.Error("expected execution count")
	}
	if !strings.Contains(output, "$18.42") {
		t.Error("expected total cost")
	}
	if !strings.Contains(output, "claude-sonnet-4") {
		t.Error("expected model name")
	}
	if !strings.Contains(output, "91.2%") {
		t.Error("expected cost share for claude-sonnet-4")
	}
	if !strings.Contains(output, "cloud-resource-assistant") {
		t.Error("expected top agent name")
	}
	if !strings.Contains(output, "2026-03-01") {
		t.Error("expected daily trend dates")
	}
}

func TestRenderOrgUsageTable_EmptyReport(t *testing.T) {
	report := &agentexecutionv1.GetOrgUsageReportOutput{
		OrgId: "org_empty",
	}

	output := captureStdout(t, func() {
		renderOrgUsageTable(report, "2026-03-01", "2026-03-31")
	})

	if !strings.Contains(output, "Organization Usage Report") {
		t.Error("expected report title even when empty")
	}
	if !strings.Contains(output, "$0.00") {
		t.Error("expected zero cost for empty report")
	}
}

func TestRenderOrgUsageTable_AgentFallsBackToID(t *testing.T) {
	report := &agentexecutionv1.GetOrgUsageReportOutput{
		OrgId:        "org_test",
		TotalCostUsd: 1.00,
		TopAgentsByCost: []*agentexecutionv1.AgentUsageSummary{
			{
				AgentId:          "agt_no_name",
				ExecutionCount:   5,
				EstimatedCostUsd: 1.00,
			},
		},
	}

	output := captureStdout(t, func() {
		renderOrgUsageTable(report, "2026-03-01", "2026-03-31")
	})

	if !strings.Contains(output, "agt_no_name") {
		t.Error("expected agent ID as fallback when name is empty")
	}
}
