package root

import (
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

func TestRenderOrgUsageTable_FullReport(t *testing.T) {
	report := &agentexecutionv1.GetOrgUsageReportOutput{
		OrgId:                  "org_acme",
		TotalAgents:            12,
		TotalSessions:          34,
		TotalExecutions:        187,
		TotalBillableCostMicros: 18_420_000,
		ModelBreakdown: []*agentexecutionv1.ModelUsage{
			{
				Model:              "claude-sonnet-4",
				InputTokens:        3000000,
				OutputTokens:       245000,
				BillableCostMicros: 16_800_000,
			},
			{
				Model:              "gpt-4o",
				InputTokens:        450000,
				OutputTokens:       35000,
				BillableCostMicros: 1_200_000,
			},
			{
				Model:              "claude-haiku-4",
				InputTokens:        300000,
				OutputTokens:       12000,
				BillableCostMicros: 420_000,
			},
		},
		TopAgentsByCost: []*agentexecutionv1.AgentUsageSummary{
			{
				AgentId:            "agt_001",
				AgentName:          "cloud-resource-assistant",
				ExecutionCount:     52,
				BillableCostMicros: 5_200_000,
			},
			{
				AgentId:            "agt_002",
				AgentName:          "code-reviewer",
				ExecutionCount:     38,
				BillableCostMicros: 3_800_000,
			},
		},
		DailyCosts: []*agentexecutionv1.DailyCostEntry{
			{Date: "2026-03-01", ExecutionCount: 14, BillableCostMicros: 1_420_000},
			{Date: "2026-03-02", ExecutionCount: 12, BillableCostMicros: 1_180_000},
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
		OrgId:                  "org_test",
		TotalBillableCostMicros: 1_000_000,
		TopAgentsByCost: []*agentexecutionv1.AgentUsageSummary{
			{
				AgentId:            "agt_no_name",
				ExecutionCount:     5,
				BillableCostMicros: 1_000_000,
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
