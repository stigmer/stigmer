package agentexecution

// Pins the org-scoping contract of GetAgentUsageReport (oss#389): the report
// aggregates only the requested org's executions of the agent, org_id is
// required, and the agent display name resolves only when the org has
// actually used the agent (contract parity with the cloud edition, where
// the same rule prevents an id-to-name oracle).

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestGetAgentUsageReport_OrgScoping(t *testing.T) {
	controller, st := setupTestController(t)
	defer st.Close()

	ctx := contextWithAgentExecutionKind()
	seed := []*agentexecutionv1.AgentExecution{
		makeExecution("e1", "s1", "agent-1", "org-a", "2026-03-10T10:00:00Z", nil),
		makeExecution("e2", "s2", "agent-1", "org-a", "2026-03-11T10:00:00Z", nil),
		makeExecution("e3", "s3", "agent-1", "org-b", "2026-03-10T10:00:00Z", nil),
		makeExecution("e4", "s4", "agent-2", "org-a", "2026-03-10T10:00:00Z", nil),
	}
	for _, exec := range seed {
		if err := st.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, exec.GetMetadata().GetId(), exec); err != nil {
			t.Fatalf("failed to seed execution %s: %v", exec.GetMetadata().GetId(), err)
		}
	}

	t.Run("aggregates only the requested org's executions of the agent", func(t *testing.T) {
		report, err := controller.GetAgentUsageReport(ctx, &agentexecutionv1.GetAgentUsageReportInput{
			AgentId: "agent-1",
			OrgId:   "org-a",
		})
		if err != nil {
			t.Fatalf("GetAgentUsageReport failed: %v", err)
		}
		if report.GetTotalExecutions() != 2 {
			t.Errorf("TotalExecutions = %d, want 2 (org-b execution must be excluded)", report.GetTotalExecutions())
		}
		if report.GetTotalSessions() != 2 {
			t.Errorf("TotalSessions = %d, want 2", report.GetTotalSessions())
		}
		for _, session := range report.GetSessions() {
			if session.GetSessionId() == "s3" {
				t.Errorf("report leaked session s3 belonging to org-b")
			}
		}
	})

	t.Run("same agent, other org sees only its own executions", func(t *testing.T) {
		report, err := controller.GetAgentUsageReport(ctx, &agentexecutionv1.GetAgentUsageReportInput{
			AgentId: "agent-1",
			OrgId:   "org-b",
		})
		if err != nil {
			t.Fatalf("GetAgentUsageReport failed: %v", err)
		}
		if report.GetTotalExecutions() != 1 {
			t.Errorf("TotalExecutions = %d, want 1", report.GetTotalExecutions())
		}
	})

	t.Run("org_id is required", func(t *testing.T) {
		_, err := controller.GetAgentUsageReport(ctx, &agentexecutionv1.GetAgentUsageReportInput{
			AgentId: "agent-1",
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("error code = %v, want InvalidArgument", status.Code(err))
		}
	})

	t.Run("agent_id is required", func(t *testing.T) {
		_, err := controller.GetAgentUsageReport(ctx, &agentexecutionv1.GetAgentUsageReportInput{
			OrgId: "org-a",
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("error code = %v, want InvalidArgument", status.Code(err))
		}
	})
}

func TestGetAgentUsageReport_NameResolutionRequiresOrgUsage(t *testing.T) {
	controller, st := setupTestController(t)
	defer st.Close()

	ctx := contextWithAgentExecutionKind()
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-1",
			Name: "PR Reviewer",
			Org:  "org-a",
		},
	}
	if err := st.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, "agent-1", agent); err != nil {
		t.Fatalf("failed to seed agent: %v", err)
	}
	exec := makeExecution("e1", "s1", "agent-1", "org-a", "2026-03-10T10:00:00Z", nil)
	if err := st.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, "e1", exec); err != nil {
		t.Fatalf("failed to seed execution: %v", err)
	}

	t.Run("resolves the name when the org has executions", func(t *testing.T) {
		report, err := controller.GetAgentUsageReport(ctx, &agentexecutionv1.GetAgentUsageReportInput{
			AgentId: "agent-1",
			OrgId:   "org-a",
		})
		if err != nil {
			t.Fatalf("GetAgentUsageReport failed: %v", err)
		}
		if report.GetAgentName() != "PR Reviewer" {
			t.Errorf("AgentName = %q, want %q", report.GetAgentName(), "PR Reviewer")
		}
	})

	t.Run("echoes the id when the org never used the agent", func(t *testing.T) {
		report, err := controller.GetAgentUsageReport(ctx, &agentexecutionv1.GetAgentUsageReportInput{
			AgentId: "agent-1",
			OrgId:   "org-b",
		})
		if err != nil {
			t.Fatalf("GetAgentUsageReport failed: %v", err)
		}
		if report.GetAgentName() != "agent-1" {
			t.Errorf("AgentName = %q, want the raw id %q (no name oracle)", report.GetAgentName(), "agent-1")
		}
	})
}
