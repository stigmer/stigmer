package root

import (
	"strings"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// =============================================================================
// agentSummaryTitleAndStyle Tests
// =============================================================================

func TestAgentSummaryTitleAndStyle_Completed(t *testing.T) {
	title, _ := agentSummaryTitleAndStyle(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	if title != "EXECUTION COMPLETE" {
		t.Errorf("expected title 'EXECUTION COMPLETE', got %q", title)
	}
}

func TestAgentSummaryTitleAndStyle_Failed(t *testing.T) {
	title, _ := agentSummaryTitleAndStyle(agentexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	if title != "EXECUTION FAILED" {
		t.Errorf("expected title 'EXECUTION FAILED', got %q", title)
	}
}

func TestAgentSummaryTitleAndStyle_Cancelled(t *testing.T) {
	title, _ := agentSummaryTitleAndStyle(agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED)
	if title != "EXECUTION CANCELLED" {
		t.Errorf("expected title 'EXECUTION CANCELLED', got %q", title)
	}
}

func TestAgentSummaryTitleAndStyle_Terminated(t *testing.T) {
	title, _ := agentSummaryTitleAndStyle(agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED)
	if title != "EXECUTION TERMINATED" {
		t.Errorf("expected title 'EXECUTION TERMINATED', got %q", title)
	}
}

// =============================================================================
// buildAgentSummaryContent Tests
// =============================================================================

func TestBuildAgentSummaryContent_Success(t *testing.T) {
	startTime := time.Now().Add(-30 * time.Second)
	endTime := time.Now()

	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:       agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			StartedAt:   startTime.Format(time.RFC3339),
			CompletedAt: endTime.Format(time.RFC3339),
			Messages: []*agentexecutionv1.AgentMessage{
				{Content: "msg1"},
				{Content: "msg2"},
				{Content: "msg3", ToolCalls: []*agentexecutionv1.ToolCall{
					{Name: "read_file"},
					{Name: "write_file"},
				}},
			},
		},
	}

	content := buildAgentSummaryContent(execution)

	// Verify duration is present
	if !strings.Contains(content, "Duration:") {
		t.Error("expected Duration in summary content")
	}
	if !strings.Contains(content, "30s") {
		t.Error("expected ~30s duration in summary content")
	}

	// Verify stats (4-space alignment)
	if !strings.Contains(content, "Messages:    3") {
		t.Error("expected 'Messages:    3' in summary content")
	}
	if !strings.Contains(content, "Tool calls:  2") {
		t.Error("expected 'Tool calls:  2' in summary content")
	}

	// Verify no error section for success
	if strings.Contains(content, "Error:") {
		t.Error("expected no Error section for successful execution")
	}
}

func TestBuildAgentSummaryContent_Failure(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: "agent exceeded maximum retries",
			Messages: []*agentexecutionv1.AgentMessage{
				{Content: "msg1"},
			},
		},
	}

	content := buildAgentSummaryContent(execution)

	// Verify error message is present and first
	if !strings.Contains(content, "Error: agent exceeded maximum retries") {
		t.Error("expected error message in summary content")
	}

	// Error should appear before stats
	errorIdx := strings.Index(content, "Error:")
	messagesIdx := strings.Index(content, "Messages:")
	if errorIdx > messagesIdx {
		t.Error("error should appear before Messages in summary")
	}
}

func TestBuildAgentSummaryContent_NoDuration(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
			Messages: []*agentexecutionv1.AgentMessage{},
		},
	}

	content := buildAgentSummaryContent(execution)

	// Verify no duration when timestamps are empty
	if strings.Contains(content, "Duration:") {
		t.Error("expected no Duration when timestamps are empty")
	}
}

func TestBuildAgentSummaryContent_WithArtifacts(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{},

			Artifacts: []*agentexecutionv1.ExecutionArtifact{
				{Name: "SKILL.md"},
				{Name: "README.md"},
			},
		},
	}

	content := buildAgentSummaryContent(execution)

	if !strings.Contains(content, "Artifacts:   2") {
		t.Error("expected 'Artifacts:   2' in summary content")
	}
}

func TestBuildAgentSummaryContent_NoArtifacts(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{},
		},
	}

	content := buildAgentSummaryContent(execution)

	if strings.Contains(content, "Artifacts:") {
		t.Error("expected no Artifacts line when there are none")
	}
}

// =============================================================================
// displayAgentExecutionComplete Tests (Panel Output)
// =============================================================================

func TestDisplayAgentExecutionComplete_SuccessPanel(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{{Content: "done"}},
		},
	}

	output := captureStdout(t, func() {
		displayAgentExecutionComplete(execution)
	})

	// Verify panel structure
	if !strings.Contains(output, "╭") || !strings.Contains(output, "╯") {
		t.Error("expected panel border characters in output")
	}
	if !strings.Contains(output, "EXECUTION COMPLETE") {
		t.Error("expected 'EXECUTION COMPLETE' title in output")
	}
}

func TestDisplayAgentExecutionComplete_FailurePanel(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:    agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error:    "timeout",
			Messages: []*agentexecutionv1.AgentMessage{},
		},
	}

	output := captureStdout(t, func() {
		displayAgentExecutionComplete(execution)
	})

	if !strings.Contains(output, "EXECUTION FAILED") {
		t.Error("expected 'EXECUTION FAILED' title in output")
	}
	if !strings.Contains(output, "timeout") {
		t.Error("expected error message in output")
	}
}

// =============================================================================
// workflowSummaryTitleAndStyle Tests
// =============================================================================

func TestWorkflowSummaryTitleAndStyle_Completed(t *testing.T) {
	title, _ := workflowSummaryTitleAndStyle(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	if title != "WORKFLOW COMPLETE" {
		t.Errorf("expected title 'WORKFLOW COMPLETE', got %q", title)
	}
}

func TestWorkflowSummaryTitleAndStyle_Failed(t *testing.T) {
	title, _ := workflowSummaryTitleAndStyle(workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	if title != "WORKFLOW FAILED" {
		t.Errorf("expected title 'WORKFLOW FAILED', got %q", title)
	}
}

// =============================================================================
// buildWorkflowSummaryContent Tests
// =============================================================================

func TestBuildWorkflowSummaryContent_TaskBreakdown(t *testing.T) {
	startTime := time.Now().Add(-2 * time.Minute)
	endTime := time.Now()

	execution := &workflowexecutionv1.WorkflowExecution{
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase:       workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			StartedAt:   startTime.Format(time.RFC3339),
			CompletedAt: endTime.Format(time.RFC3339),
			Tasks: []*workflowexecutionv1.WorkflowTask{
				{TaskName: "t1", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
				{TaskName: "t2", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
				{TaskName: "t3", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED},
				{TaskName: "t4", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED},
			},
		},
	}

	content := buildWorkflowSummaryContent(execution)

	if !strings.Contains(content, "4 total") {
		t.Error("expected '4 total' in task breakdown")
	}
	if !strings.Contains(content, "2 completed") {
		t.Error("expected '2 completed' in task breakdown")
	}
	if !strings.Contains(content, "1 failed") {
		t.Error("expected '1 failed' in task breakdown")
	}
	if !strings.Contains(content, "1 skipped") {
		t.Error("expected '1 skipped' in task breakdown")
	}
}

func TestBuildWorkflowSummaryContent_AllCompleted(t *testing.T) {
	execution := &workflowexecutionv1.WorkflowExecution{
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Tasks: []*workflowexecutionv1.WorkflowTask{
				{TaskName: "t1", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
				{TaskName: "t2", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
			},
		},
	}

	content := buildWorkflowSummaryContent(execution)

	// Should not contain failed or skipped lines
	if strings.Contains(content, "failed") {
		t.Error("expected no 'failed' line when no tasks failed")
	}
	if strings.Contains(content, "skipped") {
		t.Error("expected no 'skipped' line when no tasks skipped")
	}
}

func TestBuildWorkflowSummaryContent_FailureWithError(t *testing.T) {
	execution := &workflowexecutionv1.WorkflowExecution{
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: "task 'deploy' failed: connection refused",
			Tasks: []*workflowexecutionv1.WorkflowTask{
				{TaskName: "build", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
				{TaskName: "deploy", Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED},
			},
		},
	}

	content := buildWorkflowSummaryContent(execution)

	if !strings.Contains(content, "connection refused") {
		t.Error("expected error message in summary content")
	}
}

// =============================================================================
// countWorkflowTasks Tests
// =============================================================================

func TestCountWorkflowTasks_MixedStatuses(t *testing.T) {
	tasks := []*workflowexecutionv1.WorkflowTask{
		{Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
		{Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED},
		{Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED},
		{Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED},
		{Status: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS},
	}

	completed, failed, skipped := countWorkflowTasks(tasks)

	if completed != 2 {
		t.Errorf("expected 2 completed, got %d", completed)
	}
	if failed != 1 {
		t.Errorf("expected 1 failed, got %d", failed)
	}
	if skipped != 1 {
		t.Errorf("expected 1 skipped, got %d", skipped)
	}
}

func TestCountWorkflowTasks_EmptyList(t *testing.T) {
	completed, failed, skipped := countWorkflowTasks(nil)

	if completed != 0 || failed != 0 || skipped != 0 {
		t.Errorf("expected all zeros for nil tasks, got completed=%d failed=%d skipped=%d",
			completed, failed, skipped)
	}
}

// =============================================================================
// parseDuration Tests
// =============================================================================

func TestParseDuration_ValidTimestamps(t *testing.T) {
	start := time.Now().Add(-45 * time.Second).Format(time.RFC3339)
	end := time.Now().Format(time.RFC3339)

	d := parseDuration(start, end)

	// Allow 1 second tolerance for test execution time
	if d < 44*time.Second || d > 46*time.Second {
		t.Errorf("expected ~45s, got %s", d)
	}
}

func TestParseDuration_EmptyStart(t *testing.T) {
	d := parseDuration("", time.Now().Format(time.RFC3339))
	if d != 0 {
		t.Errorf("expected 0 for empty start, got %s", d)
	}
}

func TestParseDuration_EmptyEnd(t *testing.T) {
	d := parseDuration(time.Now().Format(time.RFC3339), "")
	if d != 0 {
		t.Errorf("expected 0 for empty end, got %s", d)
	}
}

func TestParseDuration_InvalidTimestamp(t *testing.T) {
	d := parseDuration("not-a-date", time.Now().Format(time.RFC3339))
	if d != 0 {
		t.Errorf("expected 0 for invalid timestamp, got %s", d)
	}
}

func TestParseDuration_NegativeDuration(t *testing.T) {
	end := time.Now().Add(-1 * time.Minute).Format(time.RFC3339)
	start := time.Now().Format(time.RFC3339)

	d := parseDuration(start, end)
	if d != 0 {
		t.Errorf("expected 0 for negative duration (end before start), got %s", d)
	}
}

// =============================================================================
// buildAgentSummaryContent Usage Cost Tests
// =============================================================================

func TestBuildAgentSummaryContent_WithUsageCost(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{Content: "done", LlmMetrics: &agentexecutionv1.LlmCallMetrics{
					Model:            "claude-sonnet-4",
					Provider:         "anthropic",
					InputTokens:      2250,
					OutputTokens:     1830,
					CacheReadTokens:  10200,
					EstimatedCostUsd: 0.074,
				}},
			},
		},
	}

	content := buildAgentSummaryContent(execution)

	if !strings.Contains(content, "Model:       claude-sonnet-4 (anthropic)") {
		t.Error("expected Model line with provider in summary content")
	}
	if !strings.Contains(content, "Cost:        $0.074 (82% cached)") {
		t.Error("expected Cost line with cache rate in summary content")
	}
}

func TestBuildAgentSummaryContent_WithUsageNoCost(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{Content: "done", LlmMetrics: &agentexecutionv1.LlmCallMetrics{
					Model:        "claude-sonnet-4",
					InputTokens:  5000,
					OutputTokens: 1000,
				}},
			},
		},
	}

	content := buildAgentSummaryContent(execution)

	if !strings.Contains(content, "Model:") {
		t.Error("expected Model line in summary content")
	}
	if strings.Contains(content, "Cost:") {
		t.Error("expected no Cost line when estimated_cost_usd is 0")
	}
}

func TestBuildAgentSummaryContent_CacheHitRateDisplay(t *testing.T) {
	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			Messages: []*agentexecutionv1.AgentMessage{
				{LlmMetrics: &agentexecutionv1.LlmCallMetrics{
					InputTokens:      10000,
					OutputTokens:     1000,
					EstimatedCostUsd: 0.05,
					CacheReadTokens:  0,
				}},
			},
		},
	}

	content := buildAgentSummaryContent(execution)

	if !strings.Contains(content, "Cost:        $0.050") {
		t.Error("expected Cost line without cache rate")
	}
	if strings.Contains(content, "cached") {
		t.Error("expected no 'cached' text when cache_read_tokens is 0")
	}
}

// =============================================================================
// summaryPanelWidth Tests
// =============================================================================

func TestSummaryPanelWidth_DoesNotExceedMax(t *testing.T) {
	width := summaryPanelWidth()
	if width > maxPanelWidth {
		t.Errorf("summaryPanelWidth() = %d, exceeds maxPanelWidth %d", width, maxPanelWidth)
	}
}
