package root

import (
	"context"
	"fmt"
	"io"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/pkg/errors"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"google.golang.org/grpc"
)

// streamAgentExecution subscribes to execution updates and displays them in
// a Bubbletea alt-screen TUI. The TUI provides a scrollable viewport with
// auto-follow, inline approval handling, and streams AI content incrementally.
//
// When sessionID and orgID are provided, the TUI enters conversational mode:
// after an execution completes, the user can type follow-up messages that
// create new executions within the same session. The returned execution is
// the last one that ran (which may be a follow-up, not the original).
//
// A background goroutine reads the gRPC stream and converts updates into TUI
// events sent over a channel. The TUI model receives these events and renders
// content blocks in a viewport.
//
// Approval is handled inline in the TUI: when the goroutine detects an approval
// request, it sends an ApprovalNeededEvent. The TUI shows a prompt and captures
// the user's key press (a/s/r). The response flows back via a channel, and the
// goroutine submits the decision to the backend API.
//
// After the TUI exits (execution completes or user quits), a summary is printed
// to inline stdout so the terminal history shows the final state.
func streamAgentExecution(sessionID, executionID, orgID string, prompter approval.Prompter, defaultAction approval.Action, verbose bool, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	cliprint.PrintSuccess("Streaming session...")
	fmt.Println()

	// Create streaming client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	ctx := context.Background()

	// Subscribe to execution updates
	stream, err := client.Subscribe(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		return nil, errors.Wrap(err, "failed to subscribe to agent execution")
	}

	// Channels for communication between gRPC goroutine and TUI.
	// events: gRPC goroutine -> TUI (execution state changes)
	// approvalResponses: TUI -> gRPC goroutine (user's approval decisions)
	events := make(chan executiontui.Event, 16)
	approvalResponses := make(chan executiontui.ApprovalResponse, 1)

	// CancelFn is called by the TUI when the user confirms cancellation.
	// It invokes the Cancel API; the backend will transition the execution
	// to CANCELLED and the stream will deliver the phase change.
	cancelFn := func() error {
		_, err := execution.Cancel(conn, executionID)
		return err
	}

	// FollowUpFn enables conversational mode: after an execution completes,
	// the user can type a follow-up message. This closure creates a new
	// execution in the same session, subscribes to its stream, and returns
	// the channels needed for the TUI to render it.
	var followUpFn executiontui.FollowUpFn
	if sessionID != "" {
		followUpFn = buildFollowUpFn(ctx, sessionID, orgID, conn)
	}

	// Create and configure the TUI model.
	model := executiontui.New(executiontui.Config{
		SessionID:         sessionID,
		ExecutionID:       executionID,
		Events:            events,
		ApprovalResponses: approvalResponses,
		CancelFn:          cancelFn,
		FollowUpFn:        followUpFn,
		Verbose:           verbose,
	})

	// Launch the gRPC stream goroutine that converts proto updates to TUI events.
	go streamToEvents(ctx, streamToEventsConfig{
		executionID:       executionID,
		stream:            stream,
		events:            events,
		approvalResponses: approvalResponses,
		conn:              conn,
	})

	// Run the TUI in alt-screen mode. This blocks until the TUI exits.
	p := tea.NewProgram(model, tea.WithAltScreen())
	finalModel, err := p.Run()
	if err != nil {
		return nil, errors.Wrap(err, "TUI execution failed")
	}

	// Extract the final state from the TUI model.
	result := finalModel.(executiontui.Model)

	if result.FinalError() != "" && !result.Done() {
		return nil, errors.New(result.FinalError())
	}

	// The TUI has exited and the terminal is back to inline mode.
	// Fetch the final execution state. When follow-ups were sent, use the
	// latest execution ID rather than the original.
	latestExecID := result.LatestExecutionID()
	finalExec, err := fetchFinalExecution(ctx, conn, latestExecID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to fetch final execution state")
	}

	// Print the appropriate summary to inline stdout.
	// When a session ID is available, use the concise single-line format.
	// Otherwise, fall back to the verbose panel format for backwards compat.
	if sessionID != "" {
		if result.Done() {
			displaySessionExitLine(sessionID, finalExec)
		} else {
			displaySessionDetachLine(sessionID)
		}
	} else {
		if result.Done() {
			displayAgentExecutionComplete(finalExec)
		} else {
			displayAgentExecutionDetached(finalExec)
		}
	}

	return finalExec, nil
}

// buildFollowUpFn creates a FollowUpFn closure that creates follow-up
// executions within the given session. Each call creates a new execution,
// subscribes to its gRPC stream, and launches a streamToEvents goroutine.
func buildFollowUpFn(ctx context.Context, sessionID, orgID string, conn *grpc.ClientConn) executiontui.FollowUpFn {
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)

	return func(message string) (*executiontui.FollowUpResult, error) {
		exec, err := createAgentExecution(CreateAgentExecutionInput{
			SessionID: sessionID,
			OrgID:     orgID,
			Message:   message,
			Conn:      conn,
		})
		if err != nil {
			return nil, err
		}

		newExecID := exec.GetMetadata().GetId()

		stream, err := client.Subscribe(ctx, &agentexecutionv1.AgentExecutionId{Value: newExecID})
		if err != nil {
			return nil, errors.Wrap(err, "failed to subscribe to follow-up execution")
		}

		events := make(chan executiontui.Event, 16)
		approvalResponses := make(chan executiontui.ApprovalResponse, 1)

		cancelFn := func() error {
			_, err := execution.Cancel(conn, newExecID)
			return err
		}

		go streamToEvents(ctx, streamToEventsConfig{
			executionID:       newExecID,
			stream:            stream,
			events:            events,
			approvalResponses: approvalResponses,
			conn:              conn,
		})

		return &executiontui.FollowUpResult{
			ExecutionID:       newExecID,
			Events:            events,
			ApprovalResponses: approvalResponses,
			CancelFn:          cancelFn,
		}, nil
	}
}

// fetchFinalExecution retrieves the current execution state from the backend.
// Called after the TUI exits to get the full proto object for the summary display
// and to return to the caller.
func fetchFinalExecution(ctx context.Context, conn *grpc.ClientConn, executionID string) (*agentexecutionv1.AgentExecution, error) {
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	resp, err := client.Get(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get agent execution")
	}
	return resp, nil
}

// streamWorkflowExecution subscribes to workflow execution updates and displays them in real-time.
// When a child agent execution requires approval, it prompts the user for a decision
// and submits it via the workflow API (which forwards to the child agent).
//
// The streaming loop follows the same invariant as streamAgentExecution: render content
// before status, prompt before proceeding.
//
// The prompter is injected to support both interactive (TTY) and non-interactive (CI) modes.
// defaultAction is the --approve-default flag value; when set, non-TTY approvals
// are auto-resolved without prompting.
func streamWorkflowExecution(executionID string, prompter approval.Prompter, defaultAction approval.Action, conn *grpc.ClientConn) (*workflowexecutionv1.WorkflowExecution, error) {
	cliprint.PrintSuccess("Streaming workflow execution logs")
	fmt.Println()

	// Create streaming client
	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)
	ctx := context.Background()

	// Subscribe to execution updates
	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to subscribe to workflow execution")
	}

	// Activity spinner — shows progress between streaming updates.
	sp := spinner.New(os.Stdout)
	sp.Start("Waiting for workflow...")
	defer sp.Stop()

	// Track last displayed phase, tasks, and approval state.
	var lastPhase workflowexecutionv1.ExecutionPhase
	promptedToolCallIDs := make(map[string]bool)
	taskCount := 0

	// Stream updates until execution completes
	for {
		execution, err := stream.Recv()
		if err != nil {
			sp.Stop()
			if err == io.EOF {
				return nil, errors.New("workflow execution stream ended unexpectedly")
			}
			return nil, errors.Wrap(err, "workflow execution stream error")
		}

		// Step 1: Display new tasks FIRST — show what happened before status changes.
		if len(execution.Status.Tasks) > taskCount {
			sp.Stop()
			for i := taskCount; i < len(execution.Status.Tasks); i++ {
				displayWorkflowTask(execution.Status.Tasks[i])
			}
			taskCount = len(execution.Status.Tasks)
			sp.Start("Workflow running...")
		}

		// Step 2: Handle approval flow when child agent requires approval.
		// Workflows surface approvals via pending_approvals (populated by child agent signal).
		for _, pendingApproval := range execution.Status.GetPendingApprovals() {
			if pendingApproval.ToolCallId == "" || promptedToolCallIDs[pendingApproval.ToolCallId] {
				continue
			}
			sp.Stop()
			if err := handleWorkflowApprovalPrompt(ctx, conn, executionID, pendingApproval, prompter, defaultAction); err != nil {
				return nil, errors.Wrap(err, "workflow approval failed")
			}
			promptedToolCallIDs[pendingApproval.ToolCallId] = true
			sp.Start("Resuming after approval...")
		}

		// Step 3: Display phase changes (AFTER tasks and approvals handled).
		if execution.Status.Phase != lastPhase {
			sp.Stop()
			displayWorkflowPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase

			if !isTerminalWorkflowPhase(lastPhase) {
				sp.Start(spinnerLabelForWorkflowPhase(lastPhase))
			}
		}

		// Step 4: Terminal check.
		if isTerminalWorkflowPhase(execution.Status.Phase) {
			sp.Stop()
			displayWorkflowExecutionComplete(execution)
			return execution, nil
		}
	}
}
