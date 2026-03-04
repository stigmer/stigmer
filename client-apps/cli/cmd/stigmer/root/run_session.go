package root

import (
	"context"
	"fmt"
	"os"
	"slices"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"google.golang.org/grpc"
)

// executeRunSession handles the single-arg `stigmer run ses-xxx` path.
// It connects to the backend and delegates to openSession.
func executeRunSession(sessionID, orgOverride string, verbose bool, outputMode OutputMode) error {
	sp := spinner.New(os.Stderr)
	sp.Start("Connecting...")

	conn, orgID, err := connectToBackend(orgOverride)
	if err != nil {
		sp.Stop()
		return err
	}
	defer conn.Close()

	return openSession(sessionID, orgID, verbose, outputMode, conn, sp)
}

// openSession re-opens an existing session by its ID.
//
// It fetches the session, finds the latest execution, and either:
//   - Re-attaches to the live stream if the execution is still running
//   - Opens a resumable TUI with the full conversation history if all
//     executions have completed, allowing the user to continue
//
// The spinner is active on entry and stopped after session data is loaded
// (before printing session info and entering streaming/TUI).
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
	if subject != "" {
		climsg.Info("Session: %s (%s)", sessionID, subject)
	} else {
		climsg.Info("Session: %s", sessionID)
	}

	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		climsg.Info("Re-attaching to session...")
		fmt.Println()
		executionID := latestExec.GetMetadata().GetId()
		var prompter approval.Prompter
		if outputMode == OutputInline {
			prompter = approval.NewInlinePrompter(os.Stdin, os.Stderr)
		} else {
			prompter = approval.NewInteractivePrompter()
		}
		_, err := streamAgentExecution(sessionID, subject, executionID, orgID, prompter, approval.Action(0), verbose, outputMode, conn)
		return err

	default:
		return resumeSession(sessionID, subject, orgID, entries, verbose, outputMode, conn)
	}
}

// resumeSession opens a completed session with the full conversation history
// and allows the user to continue. Stored executions are converted into the
// same event stream that the live TUI processes (via snapshotToEvents), so
// noise suppression, lifecycle badges, and duplicate filtering all apply
// automatically. The input composer activates after all historical events
// are processed, letting the user send a follow-up message.
func resumeSession(sessionID, sessionSubject, orgID string, executions []*agentexecutionv1.AgentExecution, verbose bool, outputMode OutputMode, conn *grpc.ClientConn) error {
	climsg.Info("Resuming session...")
	fmt.Println()

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
	case OutputInline:
		prompter := approval.NewInlinePrompter(os.Stdin, os.Stderr)
		_, exitErr := renderInline(streamCtx, inlineRenderConfig{
			events:            events,
			approvalResponses: approvalResponses,
			prompter:          prompter,
			data:              os.Stdout,
			status:            os.Stderr,
			sessionID:         sessionID,
		})
		streamCancel()
		if exitErr != "" {
			return errors.New(exitErr)
		}
		displaySessionExitLine(sessionID, latestExec)
		return nil

	case OutputJSON:
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
		return resumeSessionInteractive(streamCtx, streamCancel, sessionID, sessionSubject, orgID, latestExecID, events, approvalResponses, verbose, conn)
	}
}

// resumeSessionInteractive runs the Bubbletea alt-screen TUI for a resumed
// session with the full conversation history and follow-up capability.
func resumeSessionInteractive(streamCtx context.Context, streamCancel context.CancelFunc, sessionID, sessionSubject, orgID, latestExecID string, events chan executiontui.Event, approvalResponses chan executiontui.ApprovalResponse, verbose bool, conn *grpc.ClientConn) error {
	followUpFn := buildFollowUpFn(streamCtx, sessionID, orgID, conn)

	var subjectFetchFn func() string
	if sessionSubject == "" {
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
		ExecutionID:       latestExecID,
		Events:            events,
		ApprovalResponses: approvalResponses,
		FollowUpFn:        followUpFn,
		SubjectFetchFn:    subjectFetchFn,
		Verbose:           verbose,
	})

	p := tea.NewProgram(model, tea.WithAltScreen())
	finalModel, err := runTUIWithProtection(p)
	streamCancel()

	if err != nil {
		return errors.Wrap(err, "TUI session failed")
	}

	result := finalModel.(executiontui.Model)

	finalExecID := result.LatestExecutionID()
	finalExec, err := fetchFinalExecution(context.Background(), conn, finalExecID)
	if err != nil {
		return errors.Wrap(err, "failed to fetch final execution state")
	}

	if result.Done() {
		displaySessionExitLine(sessionID, finalExec)
	} else {
		displaySessionDetachLine(sessionID)
	}

	return nil
}
