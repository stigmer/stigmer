package agentexecution

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// The recalled_memories_report merge contract (DD-008 D5): the field is
// runner-owned, written at most once per execution at prompt build, and the
// server's only involvement is the presence-guarded replace in
// applyUpdateStatusMerge — the same posture as streaming_usage. These are
// the first pins on that presence-guarded pattern for any runner-owned
// field: a wholesale-replacement refactor of the merge, or deletion of the
// report's merge line, fails here before it can silently drop runner data.

func selectionReport(ids ...string) *agentexecutionv1.RecalledMemoriesReport {
	return &agentexecutionv1.RecalledMemoriesReport{
		SelectionActive:   true,
		InjectedMemoryIds: ids,
		EmbeddingModel:    "text-embedding-3-small",
	}
}

// A runner persist carrying the report must store it. Without the merge
// line the presence-guarded merge silently drops the field — the exact
// failure mode this pin exists to catch.
func TestUpdateStatusMerge_StoresRunnerSentRecalledMemoriesReport(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:                  agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Messages:               messages("m1"),
		RecalledMemoriesReport: selectionReport("mem_a", "mem_b"),
	}

	merged := runBuildStep(t, existing, incoming)

	report := merged.Status.GetRecalledMemoriesReport()
	if report == nil {
		t.Fatal("runner-sent recalled_memories_report must be stored by the merge, got nil")
	}
	if !report.GetSelectionActive() {
		t.Error("selection_active must survive the merge")
	}
	if got := report.GetInjectedMemoryIds(); len(got) != 2 || got[0] != "mem_a" || got[1] != "mem_b" {
		t.Errorf("injected_memory_ids must survive the merge verbatim, got %v", got)
	}
	if report.GetEmbeddingModel() != "text-embedding-3-small" {
		t.Errorf("embedding_model must survive the merge, got %q", report.GetEmbeddingModel())
	}
}

// The report is written once at prompt build; every later streaming persist
// omits it. The presence guard must preserve the stored report across those
// report-less writes — including the terminal persist.
func TestUpdateStatusMerge_PreservesStoredReportAcrossReportlessWrites(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1")
	existing.Status.RecalledMemoriesReport = selectionReport("mem_a")

	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		Messages: messages("m1", "m2"),
	}

	merged := runBuildStep(t, existing, incoming)

	report := merged.Status.GetRecalledMemoriesReport()
	if report == nil {
		t.Fatal("stored recalled_memories_report must survive a report-less status write, got nil")
	}
	if got := report.GetInjectedMemoryIds(); len(got) != 1 || got[0] != "mem_a" {
		t.Errorf("stored report must be preserved verbatim, got ids %v", got)
	}
}

// Absent everywhere = wholesale, true by construction: a full status
// lifecycle with no runner report must persist no report — the server
// never invents one.
func TestUpdateStatusMerge_NeverInventsAReport(t *testing.T) {
	existing := existingWith(agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, "m1")
	incoming := &agentexecutionv1.AgentExecutionStatus{
		Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		Messages: messages("m1", "m2"),
	}

	merged := runBuildStep(t, existing, incoming)

	if merged.Status.GetRecalledMemoriesReport() != nil {
		t.Fatal("the server must never write recalled_memories_report on its own (runner-owned, single writer)")
	}
}
