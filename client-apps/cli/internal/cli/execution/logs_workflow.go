package execution

import (
	"context"
	"fmt"
	"io"

	"github.com/fatih/color"
	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// WorkflowLogsOptions contains options for viewing workflow execution logs.
type WorkflowLogsOptions struct {
	ExecutionID string
	Follow      bool
	TaskFilter  string
	Client      *stigmer.Client
}

// WorkflowLogs fetches and displays workflow execution event logs.
func WorkflowLogs(opts *WorkflowLogsOptions) error {
	if opts.Follow {
		return streamWorkflowEvents(opts)
	}
	return fetchWorkflowEventLog(opts)
}

func fetchWorkflowEventLog(opts *WorkflowLogsOptions) error {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	req := &workflowexecutionv1.GetEventLogRequest{
		ExecutionId: opts.ExecutionID,
		PageSize:    50,
	}
	if opts.TaskFilter != "" {
		req.TaskName = opts.TaskFilter
	}

	resp, err := opts.Client.WorkflowExecution.GetEventLog(ctx, req)
	if err != nil {
		return errors.Wrapf(err, "failed to get event log for '%s'", opts.ExecutionID)
	}

	events := resp.GetEvents()
	if len(events) == 0 {
		fmt.Println("No events recorded for this execution.")
		return nil
	}

	for _, event := range events {
		renderWorkflowEvent(event)
	}

	if resp.GetHasMore() {
		fmt.Printf("\n... more events available (showing first %d)\n", len(events))
	}

	return nil
}

func streamWorkflowEvents(opts *WorkflowLogsOptions) error {
	ctx := context.Background()

	req := &workflowexecutionv1.SubscribeEventsRequest{
		ExecutionId: opts.ExecutionID,
	}

	stream, err := opts.Client.WorkflowExecution.SubscribeEvents(ctx, req)
	if err != nil {
		return errors.Wrapf(err, "failed to subscribe to events for '%s'", opts.ExecutionID)
	}

	for {
		event, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				fmt.Println("\n--- stream ended ---")
				return nil
			}
			return errors.Wrap(err, "event stream error")
		}

		if opts.TaskFilter != "" && event.GetTaskName() != opts.TaskFilter {
			continue
		}

		renderWorkflowEvent(event)
	}
}

func renderWorkflowEvent(event *workflowexecutionv1.WorkflowExecutionEvent) {
	ts := formatEventTimestamp(event.GetOccurredAt())
	taskName := event.GetTaskName()

	prefix := color.New(color.FgHiBlack).Sprintf("[%s]", ts)

	switch event.GetEventType() {
	case workflowexecutionv1.WorkflowEventType_execution_started:
		fmt.Printf("%s %s execution started\n", prefix, color.GreenString("▶"))

	case workflowexecutionv1.WorkflowEventType_execution_completed:
		fmt.Printf("%s %s execution completed\n", prefix, color.GreenString("✓"))

	case workflowexecutionv1.WorkflowEventType_execution_failed:
		p := event.GetExecutionFailed()
		fmt.Printf("%s %s execution failed: %s\n", prefix, color.RedString("✗"), p.GetError())

	case workflowexecutionv1.WorkflowEventType_execution_paused:
		fmt.Printf("%s %s execution paused\n", prefix, color.YellowString("⏸"))

	case workflowexecutionv1.WorkflowEventType_execution_resumed:
		fmt.Printf("%s %s execution resumed\n", prefix, color.GreenString("▶"))

	case workflowexecutionv1.WorkflowEventType_execution_cancelled:
		fmt.Printf("%s %s execution cancelled\n", prefix, color.YellowString("⊘"))

	case workflowexecutionv1.WorkflowEventType_execution_terminated:
		fmt.Printf("%s %s execution terminated\n", prefix, color.RedString("⊘"))

	case workflowexecutionv1.WorkflowEventType_task_started:
		fmt.Printf("%s %s task started: %s\n", prefix, color.CyanString("→"), taskName)

	case workflowexecutionv1.WorkflowEventType_task_completed:
		fmt.Printf("%s %s task completed: %s\n", prefix, color.GreenString("✓"), taskName)

	case workflowexecutionv1.WorkflowEventType_task_failed:
		p := event.GetTaskFailed()
		fmt.Printf("%s %s task failed: %s — %s\n", prefix, color.RedString("✗"), taskName, p.GetError())

	case workflowexecutionv1.WorkflowEventType_task_skipped:
		fmt.Printf("%s %s task skipped: %s\n", prefix, color.HiBlackString("⊘"), taskName)

	case workflowexecutionv1.WorkflowEventType_task_retrying:
		p := event.GetTaskRetrying()
		fmt.Printf("%s %s task retrying: %s (attempt %d)\n", prefix, color.YellowString("↻"), taskName, p.GetNextAttempt())

	case workflowexecutionv1.WorkflowEventType_agent_call_started:
		fmt.Printf("%s %s agent call started: %s\n", prefix, color.CyanString("⚡"), taskName)

	case workflowexecutionv1.WorkflowEventType_agent_call_completed:
		fmt.Printf("%s %s agent call completed: %s\n", prefix, color.GreenString("⚡"), taskName)

	case workflowexecutionv1.WorkflowEventType_approval_requested:
		p := event.GetApprovalRequested()
		fmt.Printf("%s %s approval requested: %s — %s\n", prefix, color.YellowString("⏳"), taskName, p.GetPrompt())

	case workflowexecutionv1.WorkflowEventType_approval_resolved:
		p := event.GetApprovalResolved()
		fmt.Printf("%s %s approval resolved: %s — %s by %s\n", prefix, color.GreenString("✓"), taskName, p.GetAction().String(), p.GetResolvedBy())

	case workflowexecutionv1.WorkflowEventType_budget_checkpoint:
		p := event.GetBudgetCheckpoint()
		costUsd := float64(p.GetCostConsumedMicros()) / 1_000_000.0
		fmt.Printf("%s %s budget: $%.4f spent\n", prefix, color.HiBlackString("$"), costUsd)

	default:
		fmt.Printf("%s   event: %s\n", prefix, event.GetEventType().String())
	}
}

func formatEventTimestamp(ts string) string {
	if len(ts) > 19 {
		return ts[11:19]
	}
	if ts == "" {
		return "--------"
	}
	return ts
}
