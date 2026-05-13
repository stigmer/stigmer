package execution

import (
	"fmt"

	"github.com/fatih/color"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

func renderWorkflowTrace(exec *workflowexecutionv1.WorkflowExecution) {
	name := exec.GetMetadata().GetName()
	if name == "" {
		name = exec.GetMetadata().GetId()
	}

	phase := FormatWorkflowPhase(exec.GetStatus().GetPhase())
	duration := calculateDuration(exec.GetStatus().GetStartedAt(), exec.GetStatus().GetCompletedAt())

	fmt.Println()
	fmt.Printf("Workflow: %s (%s, %s)\n", name, phase, duration)
	fmt.Println()

	tasks := exec.GetStatus().GetTasks()
	if len(tasks) == 0 {
		fmt.Println("  (no tasks recorded)")
		fmt.Println()
		return
	}

	for _, task := range tasks {
		renderWorkflowTraceTask(task)
	}

	fmt.Println()
}

func renderWorkflowTraceTask(task *workflowexecutionv1.WorkflowTask) {
	statusIcon := workflowTaskStatusIcon(task.GetStatus())
	taskName := task.GetTaskName()
	if taskName == "" {
		taskName = task.GetTaskId()
	}

	duration := calculateDuration(task.GetStartedAt(), task.GetCompletedAt())
	taskType := formatWorkflowTaskType(task.GetTaskType())

	fmt.Printf("  %s %-25s  %-8s  %s\n",
		statusIcon,
		display.TruncateWithEllipsis(taskName, 25),
		duration,
		color.New(color.FgHiBlack).Sprint(taskType),
	)

	if task.GetError() != "" {
		fmt.Printf("       %s\n", color.RedString(display.TruncateWithEllipsis(task.GetError(), 70)))
	}
}

func workflowTaskStatusIcon(s workflowexecutionv1.WorkflowTaskStatus) string {
	switch s {
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
		return color.GreenString("[done]")
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS:
		return color.CyanString("[run ]")
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_PENDING:
		return color.HiBlackString("[    ]")
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
		return color.RedString("[fail]")
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
		return color.HiBlackString("[skip]")
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL:
		return color.YellowString("[wait]")
	default:
		return "[ ?? ]"
	}
}
