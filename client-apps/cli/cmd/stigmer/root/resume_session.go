package root

import (
	"context"
	"os"
	"slices"

	tea "charm.land/bubbletea/v2"
	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"google.golang.org/grpc"
)

// executeRunSession handles the `stigmer resume ses-xxx` path.
// It connects to the backend and delegates to openSession.
func executeRunSession(sessionID, orgOverride string, verbose bool, outputMode OutputMode) error {
	sp := spinner.New(os.Stderr)
	sp.Start("Connecting...")

	client, orgID, err := connectToBackend(orgOverride)
	if err != nil {
		sp.Stop()
		return err
	}
	defer client.Close()
	conn := client.Conn().(*grpc.ClientConn)

	return openSession(sessionID, orgID, verbose, outputMode, conn, sp)
}

// openSession re-opens an existing session by its ID.
//
// It fetches the session, finds the latest execution, and either:
//   - Re-attaches to the live stream if the execution is still running
//   - Resumes with the full conversation history if all executions have
//     completed, allowing the user to continue
//
// The spinner is active on entry and stopped after session data is loaded.
func openSession(sessionID, orgID string, verbose bool, outputMode OutputMode, conn *grpc.ClientConn, sp *spinner.Spinner) error {
	sp.Update("Loading session...")
	ses, err := session.GetFromBackend(conn, sessionID)
	if err != nil {
		sp.Stop()
		climsg.Error("Session not found: %s", sessionID)
		return err
	}

	sp.Update("Loading session history...")
	execList, err := execution.ListBySession(&execution.ListBySessionOptions{
		Conn:      conn,
		SessionID: sessionID,
		PageSize:  execution.MaxPageSize,
	})
	if err != nil {
		sp.Stop()
		return errors.Wrap(err, "failed to list session executions")
	}

	sp.Stop()

	entries := execList.GetEntries()
	if len(entries) == 0 {
		climsg.Warning("Session %s has no executions", sessionID)
		return nil
	}

	latestExec := entries[0]
	phase := latestExec.GetStatus().GetPhase()

	subject := session.ResolvedSubject(ses.GetSpec().GetSubject())
	wsRoots := localWorkspaceRoots(ses.GetSpec().GetWorkspaceEntries())

	var model string
	if u := computeExecutionUsage(latestExec); u != nil {
		model = u.PrimaryModel
	}
	headerInfo := sessionHeaderInfo{
		SessionID:  sessionID,
		Subject:    subject,
		Model:      model,
		Version:    embedded.GetBuildVersion(),
		Workspaces: wsRoots,
		IsResumed:  true,
	}

	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		executionID := latestExec.GetMetadata().GetId()
		prompter := approval.NewInlinePrompter(os.Stdin, os.Stderr)
		_, err := streamAgentExecution(sessionID, headerInfo, executionID, orgID, prompter, approval.Action(0), verbose, outputMode, conn, wsRoots, os.Stdout, os.Stderr)
		return err

	default:
		return resumeSession(sessionID, headerInfo, orgID, entries, verbose, outputMode, conn, wsRoots)
	}
}

// resumeSession opens a completed session with the full conversation history
// and allows the user to continue. Stored executions are converted into the
// same event stream (via snapshotToEvents), so noise suppression, lifecycle
// badges, and duplicate filtering all apply automatically. The follow-up
// prompt activates after all historical events are rendered.
func resumeSession(sessionID string, headerInfo sessionHeaderInfo, orgID string, executions []*agentexecutionv1.AgentExecution, verbose bool, outputMode OutputMode, conn *grpc.ClientConn, workspaceRoots []string) error {

	chronological := make([]*agentexecutionv1.AgentExecution, len(executions))
	copy(chronological, executions)
	slices.Reverse(chronological)

	latestExec := executions[0]
	latestExecID := latestExec.GetMetadata().GetId()

	streamCtx, streamCancel := context.WithCancel(context.Background())

	events := make(chan executiontui.Event, 256)
	approvalResponses := make(chan executiontui.ApprovalResponse, 1)
	go snapshotToEvents(chronological, events)

	switch outputMode {
	case OutputJSON:
		renderSessionHeader(os.Stderr, headerInfo)
		_, exitErr := renderJSON(streamCtx, jsonRenderConfig{
			events:            events,
			approvalResponses: approvalResponses,
			data:              os.Stdout,
			status:            os.Stderr,
		})
		streamCancel()
		if exitErr != "" {
			return errors.New(exitErr)
		}
		return nil

	default:
		prompter := approval.NewInlinePrompter(os.Stdin, os.Stderr)
		followUpFn := buildFollowUpFn(streamCtx, sessionID, orgID, conn)

		var toggleExpandCh chan struct{}
		var cancelCh chan struct{}
		var interruptCh chan struct{}
		if termctl.IsSupported(os.Stderr) {
			toggleExpandCh = make(chan struct{}, 1)
			cancelCh = make(chan struct{}, 1)
			interruptCh = make(chan struct{}, 1)
		}

		program := startInlineProgram(os.Stderr, toggleExpandCh, cancelCh, interruptCh)

		var programFactory func(func(*inlineBubbleModel)) *managedProgram
		if program != nil {
			programFactory = func(initModel func(*inlineBubbleModel)) *managedProgram {
				m := newInlineBubbleModelWithChannels(toggleExpandCh, cancelCh, interruptCh)
				if initModel != nil {
					initModel(&m)
				}
				p := tea.NewProgram(m, tea.WithOutput(os.Stderr))
				mp := newManagedProgram(p, os.Stderr)
				mp.runAndMonitor()
				return mp
			}
		}

		sbRoot, pfDir := sessionPaths(sessionID)

		cfg := inlineRenderConfig{
			events:            events,
			approvalResponses: approvalResponses,
			prompter:          prompter,
			data:              os.Stdout,
			status:            os.Stderr,
			sessionID:         sessionID,
			workspaceRoots:    workspaceRoots,
			sandboxRoot:       sbRoot,
			platformDir:       pfDir,
			headerInfo:        headerInfo,
			program:           program,
			programFactory:    programFactory,
			toggleExpandCh:    toggleExpandCh,
			cancelCh:          cancelCh,
			interruptCh:       interruptCh,
			followUpEnabled:   toggleExpandCh != nil && followUpFn != nil,
		}
		finalExecID, _, exitErr, activeProgram := runInlineFollowUpLoop(streamCtx, cfg, followUpFn, latestExecID)

		stopInlineProgram(activeProgram)
		streamCancel()

		if exitErr != "" {
			return errors.New(exitErr)
		}
		finalExec, err := fetchFinalExecution(context.Background(), conn, finalExecID)
		if err != nil {
			return errors.Wrap(err, "failed to fetch final execution state")
		}
		displaySessionExitLine(sessionID, finalExec)
		return nil
	}
}
