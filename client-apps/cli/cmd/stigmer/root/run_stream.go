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
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"google.golang.org/grpc"
)

// streamAgentExecution subscribes to execution updates and renders them using
// the selected output mode:
//
//   - OutputInteractive: Bubbletea alt-screen TUI with scrollable viewport,
//     inline approval handling, and conversational follow-up.
//   - OutputInline: Streaming text output without alt-screen. AI content goes
//     to stdout; status/progress goes to stderr.
//   - OutputJSON: Newline-delimited JSON events on stdout for scripting/CI.
//
// A background goroutine reads the gRPC stream and converts updates into
// events sent over a channel. The consumer (TUI or renderer) receives these
// events and renders or serializes them.
//
// The returned execution is the last one that ran (which may be a follow-up
// in interactive mode, not the original).
func streamAgentExecution(sessionID, sessionSubject, executionID, orgID string, prompter approval.Prompter, defaultAction approval.Action, verbose bool, outputMode OutputMode, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	climsg.Success("Streaming session...")
	fmt.Println()

	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)

	streamCtx, streamCancel := context.WithCancel(context.Background())

	stream, err := client.Subscribe(streamCtx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		streamCancel()
		return nil, errors.Wrap(err, "failed to subscribe to agent execution")
	}

	events := make(chan executiontui.Event, 16)
	approvalResponses := make(chan executiontui.ApprovalResponse, 1)

	go streamToEvents(streamCtx, streamToEventsConfig{
		executionID:       executionID,
		sessionID:         sessionID,
		stream:            stream,
		events:            events,
		approvalResponses: approvalResponses,
		conn:              conn,
	})

	switch outputMode {
	case OutputInline:
		return streamAgentInline(streamCtx, streamCancel, sessionID, executionID, orgID, events, approvalResponses, prompter, defaultAction, conn)
	case OutputJSON:
		return streamAgentJSON(streamCtx, streamCancel, sessionID, executionID, events, approvalResponses, defaultAction, conn)
	default:
		return streamAgentInteractive(streamCtx, streamCancel, sessionID, sessionSubject, executionID, orgID, events, approvalResponses, prompter, defaultAction, verbose, conn)
	}
}

// streamAgentInteractive runs the Bubbletea alt-screen TUI. This is the
// original interactive path with scrollable viewport, approval handling,
// and conversational follow-up.
func streamAgentInteractive(streamCtx context.Context, streamCancel context.CancelFunc, sessionID, sessionSubject, executionID, orgID string, events chan executiontui.Event, approvalResponses chan executiontui.ApprovalResponse, prompter approval.Prompter, defaultAction approval.Action, verbose bool, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	cancelFn := func() error {
		_, err := execution.Cancel(conn, executionID)
		return err
	}

	var followUpFn executiontui.FollowUpFn
	if sessionID != "" {
		followUpFn = buildFollowUpFn(streamCtx, sessionID, orgID, conn)
	}

	var subjectFetchFn func() string
	if sessionID != "" && sessionSubject == "" {
		subjectFetchFn = func() string {
			ses, err := session.GetFromBackend(conn, sessionID)
			if err != nil {
				return ""
			}
			return session.ResolvedSubject(ses.GetSpec().GetSubject())
		}
	}

	model := executiontui.New(executiontui.Config{
		SessionID:         sessionID,
		SessionSubject:    sessionSubject,
		ExecutionID:       executionID,
		Events:            events,
		ApprovalResponses: approvalResponses,
		CancelFn:          cancelFn,
		FollowUpFn:        followUpFn,
		SubjectFetchFn:    subjectFetchFn,
		Verbose:           verbose,
	})

	p := tea.NewProgram(model, tea.WithAltScreen())
	finalModel, err := runTUIWithProtection(p)
	streamCancel()

	if err != nil {
		return nil, errors.Wrap(err, "TUI execution failed")
	}

	result := finalModel.(executiontui.Model)

	if result.FinalError() != "" && !result.Done() {
		return nil, errors.New(result.FinalError())
	}

	latestExecID := result.LatestExecutionID()
	finalExec, err := fetchFinalExecution(context.Background(), conn, latestExecID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to fetch final execution state")
	}

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

// streamAgentInline renders events as streaming text without the TUI.
// AI content goes to stdout, status/progress goes to stderr. When a session
// exists, a follow-up loop prompts for continued conversation after each
// execution completes.
func streamAgentInline(streamCtx context.Context, streamCancel context.CancelFunc, sessionID, executionID, orgID string, events chan executiontui.Event, approvalResponses chan executiontui.ApprovalResponse, prompter approval.Prompter, defaultAction approval.Action, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	var followUpFn executiontui.FollowUpFn
	if sessionID != "" {
		followUpFn = buildFollowUpFn(streamCtx, sessionID, orgID, conn)
	}

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: approvalResponses,
		prompter:          prompter,
		defaultAction:     defaultAction,
		data:              os.Stdout,
		status:            os.Stderr,
		sessionID:         sessionID,
	}

	latestExecID, phase, exitErr := runInlineFollowUpLoop(streamCtx, cfg, followUpFn, executionID)
	streamCancel()

	return streamAgentEpilogue(sessionID, latestExecID, phase, exitErr, conn)
}

// streamAgentJSON renders events as newline-delimited JSON on stdout.
func streamAgentJSON(streamCtx context.Context, streamCancel context.CancelFunc, sessionID, executionID string, events chan executiontui.Event, approvalResponses chan executiontui.ApprovalResponse, defaultAction approval.Action, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	phase, exitErr := renderJSON(streamCtx, jsonRenderConfig{
		events:            events,
		approvalResponses: approvalResponses,
		defaultAction:     defaultAction,
		data:              os.Stdout,
		status:            os.Stderr,
	})
	streamCancel()

	return streamAgentEpilogue(sessionID, executionID, phase, exitErr, conn)
}

// streamAgentEpilogue fetches the final execution and prints a summary.
// Shared by the inline and JSON rendering paths.
func streamAgentEpilogue(sessionID, executionID, phase, exitErr string, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	if exitErr != "" && phase == "" {
		return nil, errors.New(exitErr)
	}

	finalExec, err := fetchFinalExecution(context.Background(), conn, executionID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to fetch final execution state")
	}

	if sessionID != "" {
		displaySessionExitLine(sessionID, finalExec)
	} else {
		displayAgentExecutionComplete(finalExec)
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
			sessionID:         sessionID,
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
	climsg.Success("Streaming workflow execution logs")
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
