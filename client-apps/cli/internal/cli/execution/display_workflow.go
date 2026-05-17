package execution

import (
	"fmt"
	"os"
	"time"

	"github.com/fatih/color"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// DisplayWorkflowExecutionGetResult displays a workflow execution in the specified format.
func DisplayWorkflowExecutionGetResult(exec *workflowexecutionv1.WorkflowExecution, format string) {
	display.DisplayProto(exec, format, func() { displayWorkflowExecutionTable(exec) })
}

func displayWorkflowExecutionTable(exec *workflowexecutionv1.WorkflowExecution) {
	fmt.Println()
	fmt.Printf("Workflow Execution: %s\n", exec.GetMetadata().GetId())
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:      %s\n", exec.GetMetadata().GetId())
	fmt.Printf("  Name:    %s\n", exec.GetMetadata().GetName())
	fmt.Printf("  Org:     %s\n", exec.GetMetadata().GetOrg())
	fmt.Println()

	fmt.Printf("Spec:\n")
	if exec.GetSpec().GetWorkflowId() != "" {
		fmt.Printf("  Workflow ID:    %s\n", exec.GetSpec().GetWorkflowId())
	}
	if exec.GetSpec().GetWorkflowInstanceId() != "" {
		fmt.Printf("  Instance ID:    %s\n", exec.GetSpec().GetWorkflowInstanceId())
	}
	if exec.GetSpec().GetTriggerMessage() != "" {
		fmt.Printf("  Trigger:        %s\n", display.TruncateWithEllipsis(exec.GetSpec().GetTriggerMessage(), 60))
	}
	fmt.Println()

	status := exec.GetStatus()
	fmt.Printf("Status:\n")
	fmt.Printf("  Phase:    %s\n", FormatWorkflowPhase(status.GetPhase()))

	if status.GetStartedAt() != "" {
		fmt.Printf("  Started:  %s\n", formatTimestamp(status.GetStartedAt()))
	}
	if status.GetCompletedAt() != "" {
		fmt.Printf("  Completed: %s\n", formatTimestamp(status.GetCompletedAt()))
		fmt.Printf("  Duration:  %s\n", calculateDuration(status.GetStartedAt(), status.GetCompletedAt()))
	}

	if status.GetError() != "" {
		fmt.Println()
		fmt.Printf("Error: %s\n", status.GetError())
	}

	tasks := status.GetTasks()
	if len(tasks) > 0 {
		fmt.Println()
		fmt.Printf("Tasks: (%d total)\n", len(tasks))
		fmt.Println()
		fmt.Printf("  %-25s  %-12s  %-10s  %s\n", "NAME", "TYPE", "STATUS", "DURATION")
		fmt.Printf("  %-25s  %-12s  %-10s  %s\n", "----", "----", "------", "--------")
		for _, task := range tasks {
			fmt.Printf("  %-25s  %-12s  %-10s  %s\n",
				display.TruncateWithEllipsis(task.GetTaskName(), 25),
				formatWorkflowTaskType(task.GetTaskType()),
				formatWorkflowTaskStatus(task.GetStatus()),
				calculateDuration(task.GetStartedAt(), task.GetCompletedAt()),
			)
		}
	}

	fmt.Println()
}

// DisplayWorkflowExecutionListResult displays a list of workflow executions.
func DisplayWorkflowExecutionListResult(list *workflowexecutionv1.WorkflowExecutionList, format string) {
	entries := list.GetEntries()
	if len(entries) == 0 {
		display.DisplayEmptyResults("workflow executions", "")
		return
	}

	display.DisplayProto(list, format, func() { displayWorkflowExecutionListTable(list) })
}

func displayWorkflowExecutionListTable(list *workflowexecutionv1.WorkflowExecutionList) {
	entries := list.GetEntries()
	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()

	tbl := display.NewTable(
		[]string{"ID", "WORKFLOW", "STATUS", "TASKS", "STARTED", "DURATION"},
		display.WithHeaderColor(headerColor),
		display.WithAdaptive(),
	)

	for _, exec := range entries {
		duration := "-"
		if exec.GetStatus().GetCompletedAt() != "" {
			duration = calculateDuration(exec.GetStatus().GetStartedAt(), exec.GetStatus().GetCompletedAt())
		} else if exec.GetStatus().GetStartedAt() != "" {
			duration = calculateDuration(exec.GetStatus().GetStartedAt(), formatNow())
		}

		taskSummary := formatTaskProgress(exec.GetStatus().GetTasks())

		tbl.AddRow(
			exec.GetMetadata().GetId(),
			exec.GetSpec().GetWorkflowId(),
			FormatWorkflowPhase(exec.GetStatus().GetPhase()),
			taskSummary,
			formatTimestamp(exec.GetStatus().GetStartedAt()),
			duration,
		)
	}

	fmt.Println()
	tbl.Render(os.Stdout)

	totalPages := list.GetTotalPages()
	if totalPages > 1 {
		fmt.Printf("Page 1 of %d\n", totalPages)
	}
}

// FormatWorkflowPhase formats a workflow execution phase for display.
func FormatWorkflowPhase(phase workflowexecutionv1.ExecutionPhase) string {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		return "pending"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return "running"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "completed"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "failed"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "cancelled"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return "terminated"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		return "paused"
	default:
		return "unknown"
	}
}

func formatWorkflowTaskType(t workflowexecutionv1.WorkflowTaskType) string {
	switch t {
	case workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_AGENT_INVOCATION:
		return "agent"
	case workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_APPROVAL:
		return "approval"
	case workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_API_CALL:
		return "api_call"
	case workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_CONDITIONAL:
		return "condition"
	case workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_PARALLEL:
		return "parallel"
	case workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_TRANSFORM:
		return "transform"
	case workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_CUSTOM:
		return "custom"
	default:
		return "unknown"
	}
}

func formatWorkflowTaskStatus(s workflowexecutionv1.WorkflowTaskStatus) string {
	switch s {
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_PENDING:
		return "pending"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS:
		return "running"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
		return "done"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
		return "failed"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
		return "skipped"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL:
		return "approval"
	default:
		return "unknown"
	}
}

func formatTaskProgress(tasks []*workflowexecutionv1.WorkflowTask) string {
	if len(tasks) == 0 {
		return "-"
	}
	completed := 0
	for _, t := range tasks {
		switch t.GetStatus() {
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED,
			workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
			completed++
		}
	}
	return fmt.Sprintf("%d/%d", completed, len(tasks))
}

func formatNow() string {
	return time.Now().Format(time.RFC3339)
}
