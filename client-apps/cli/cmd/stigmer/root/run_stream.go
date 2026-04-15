package root

import (
	"context"
	"fmt"
	"io"
	"os"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/pkg/errors"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"google.golang.org/grpc"
)

// streamAgentExecution subscribes to execution updates and renders them using
// the selected output mode:
//
//   - OutputInline (default): Streaming text output in normal terminal
//     scrollback. AI content goes to stdout; status/progress goes to stderr.
//   - OutputJSON: Newline-delimited JSON events on stdout for scripting/CI.
//
// A background goroutine reads the gRPC stream and converts updates into
// events sent over a channel. The consumer (renderer) receives these events
// and renders or serializes them.
//
// The returned execution is the last one that ran (which may be a follow-up
// in inline mode, not the original).
func streamAgentExecution(sessionID string, headerInfo sessionHeaderInfo, executionID, orgID string, prompter approval.Prompter, defaultAction approval.Action, verbose bool, outputMode OutputMode, conn *grpc.ClientConn, workspaceRoots []string, dataW, statusW io.Writer) (*agentexecutionv1.AgentExecution, error) {
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
	case OutputJSON:
		renderSessionHeader(statusW, headerInfo)
		return streamAgentJSON(streamCtx, streamCancel, sessionID, executionID, events, approvalResponses, defaultAction, conn)
	default:
		return streamAgentInline(streamCtx, streamCancel, sessionID, headerInfo, executionID, orgID, events, approvalResponses, prompter, defaultAction, conn, workspaceRoots, dataW, statusW)
	}
}

// streamAgentInline renders events as streaming text without the TUI.
// AI content goes to dataW, status/progress goes to statusW. When a session
// exists, a follow-up loop prompts for continued conversation after each
// execution completes.
//
// A Bubbletea Program runs alongside the event loop in inline mode (no alt
// screen), owning the stderr writer for accurate row tracking. The Program
// is started before the first renderInline call and shut down on return.
// When the status writer is not a terminal, the Program is skipped entirely
// and all output falls back to direct writes.
func streamAgentInline(streamCtx context.Context, streamCancel context.CancelFunc, sessionID string, headerInfo sessionHeaderInfo, executionID, orgID string, events chan executiontui.Event, approvalResponses chan executiontui.ApprovalResponse, prompter approval.Prompter, defaultAction approval.Action, conn *grpc.ClientConn, workspaceRoots []string, dataW, statusW io.Writer) (*agentexecutionv1.AgentExecution, error) {
	var followUpFn executiontui.FollowUpFn
	if sessionID != "" {
		followUpFn = buildFollowUpFn(streamCtx, sessionID, orgID, conn)
	}

	var toggleExpandCh chan struct{}
	var cancelCh chan struct{}
	var interruptCh chan struct{}
	if termctl.IsSupported(statusW) {
		toggleExpandCh = make(chan struct{}, 1)
		cancelCh = make(chan struct{}, 1)
		interruptCh = make(chan struct{}, 1)
	}

	program := startInlineProgram(statusW, toggleExpandCh, cancelCh, interruptCh)

	var programFactory func(func(*inlineBubbleModel)) *managedProgram
	if program != nil {
		programFactory = func(initModel func(*inlineBubbleModel)) *managedProgram {
			m := newInlineBubbleModelWithChannels(toggleExpandCh, cancelCh, interruptCh)
			if initModel != nil {
				initModel(&m)
			}
			p := tea.NewProgram(m, tea.WithOutput(statusW))
			mp := newManagedProgram(p, statusW)
			mp.runAndMonitor()
			return mp
		}
	}

	var subjectUpdate chan string
	if sessionID != "" && headerInfo.Subject == "" {
		subjectUpdate = make(chan string, 1)
		go pollSessionSubject(streamCtx, conn, sessionID, subjectUpdate)
	}

	var recentSessionsCh chan []recentSession
	if !headerInfo.IsResumed && termctl.IsSupported(statusW) && sessionID != "" {
		recentSessionsCh = make(chan []recentSession, 1)
		go fetchRecentSessions(conn, sessionID, recentSessionsCh)
	}

	sbRoot, pfDir := sessionPaths(sessionID)

	cfg := inlineRenderConfig{
		events:            events,
		approvalResponses: approvalResponses,
		prompter:          prompter,
		defaultAction:     defaultAction,
		data:              dataW,
		status:            statusW,
		sessionID:         sessionID,
		workspaceRoots:    workspaceRoots,
		sandboxRoot:       sbRoot,
		platformDir:       pfDir,
		program:           program,
		programFactory:    programFactory,
		headerInfo:        headerInfo,
		subjectUpdate:     subjectUpdate,
		recentSessionsCh:  recentSessionsCh,
		toggleExpandCh:    toggleExpandCh,
		cancelCh:          cancelCh,
		interruptCh:       interruptCh,
		followUpEnabled:   toggleExpandCh != nil && followUpFn != nil,
		cancelExecFn: func() {
			_, _ = execution.Cancel(conn, executionID)
		},
	}

	latestExecID, phase, exitErr, activeProgram := runInlineFollowUpLoop(streamCtx, cfg, followUpFn, executionID)

	stopInlineProgram(activeProgram)
	streamCancel()

	return streamAgentEpilogue(sessionID, latestExecID, phase, exitErr, conn)
}

// startInlineProgram creates and starts a managed Bubbletea Program in
// inline mode for row-tracked stderr rendering. Returns nil when the writer
// is not a terminal (CI, piped output) — the renderer falls back to direct
// writes.
//
// When the channel arguments are non-nil, the model is wired to the event
// loop via channels and Bubbletea owns stdin (raw mode). When nil, stdin
// is not connected and input is handled externally.
//
// The returned *managedProgram monitors the underlying tea.Program's Run()
// goroutine. If Run() exits unexpectedly (e.g., terminal resize edge case),
// subsequent Println calls degrade to direct writes on statusW and Send
// calls become no-ops — the rendering pipeline never goes dark.
func startInlineProgram(statusW io.Writer, toggleCh, cancelCh, interruptCh chan struct{}) *managedProgram {
	if !termctl.IsSupported(statusW) {
		return nil
	}

	opts := []tea.ProgramOption{tea.WithOutput(statusW)}

	var model inlineBubbleModel
	if toggleCh != nil || cancelCh != nil {
		model = newInlineBubbleModelWithChannels(toggleCh, cancelCh, interruptCh)
	} else {
		model = newInlineBubbleModel()
		opts = append(opts, tea.WithInput(nil))
	}

	p := tea.NewProgram(model, opts...)
	mp := newManagedProgram(p, statusW)
	mp.runAndMonitor()
	return mp
}

// stopInlineProgram sends Quit to the managed program and waits for it
// to exit. Safe to call with nil (non-TTY path). Uses a generous timeout
// to avoid blocking indefinitely on a stuck program at session end.
func stopInlineProgram(mp *managedProgram) {
	if mp == nil {
		return
	}
	mp.Quit()
	mp.Wait(5 * time.Second)
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
// Called after the renderer exits to get the full proto for the summary display.
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
		// Workflows surface approvals via WorkflowPendingApproval wrappers.
		for _, wpa := range execution.Status.GetPendingApprovals() {
			pa := wpa.GetApproval()
			if pa.GetToolCallId() == "" || promptedToolCallIDs[pa.GetToolCallId()] {
				continue
			}
			sp.Stop()
			if err := handleWorkflowApprovalPrompt(ctx, conn, executionID, pa, prompter, defaultAction); err != nil {
				return nil, errors.Wrap(err, "workflow approval failed")
			}
			promptedToolCallIDs[pa.GetToolCallId()] = true
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
