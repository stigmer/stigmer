package root

import (
	"context"
	"fmt"
	"slices"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"google.golang.org/grpc"
)

// executeRunSession handles the single-arg `stigmer run ses-xxx` path.
// It connects to the backend and delegates to openSession.
func executeRunSession(sessionID, orgOverride string, verbose bool) error {
	conn, orgID, err := connectToBackend(orgOverride)
	if err != nil {
		return err
	}
	defer conn.Close()

	return openSession(sessionID, orgID, verbose, conn)
}

// openSession re-opens an existing session by its ID.
//
// It fetches the session, finds the latest execution, and either:
//   - Re-attaches to the live stream if the execution is still running
//   - Opens a resumable TUI with the full conversation history if all
//     executions have completed, allowing the user to continue
func openSession(sessionID, orgID string, verbose bool, conn *grpc.ClientConn) error {
	ses, err := session.GetFromBackend(conn, sessionID)
	if err != nil {
		climsg.Error("Session not found: %s", sessionID)
		return err
	}

	execList, err := execution.ListBySession(&execution.ListBySessionOptions{
		Conn:      conn,
		SessionID: sessionID,
		PageSize:  execution.MaxPageSize,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list session executions")
	}

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
		prompter := approval.NewInteractivePrompter()
		_, err := streamAgentExecution(sessionID, subject, executionID, orgID, prompter, approval.Action(0), verbose, conn)
		return err

	default:
		return resumeSession(sessionID, subject, orgID, entries, verbose, conn)
	}
}

// resumeSession opens a completed session with the full conversation history
// and allows the user to continue. Stored executions are converted into the
// same event stream that the live TUI processes (via snapshotToEvents), so
// noise suppression, lifecycle badges, and duplicate filtering all apply
// automatically. The input composer activates after all historical events
// are processed, letting the user send a follow-up message.
func resumeSession(sessionID, sessionSubject, orgID string, executions []*agentexecutionv1.AgentExecution, verbose bool, conn *grpc.ClientConn) error {
	climsg.Info("Resuming session...")
	fmt.Println()

	// The backend returns executions newest-first. Reverse for chronological
	// event emission so the conversation reads top-to-bottom.
	chronological := make([]*agentexecutionv1.AgentExecution, len(executions))
	copy(chronological, executions)
	slices.Reverse(chronological)

	latestExec := executions[0]
	latestExecID := latestExec.GetMetadata().GetId()

	ctx := context.Background()
	followUpFn := buildFollowUpFn(ctx, sessionID, orgID, conn)

	// Convert stored executions into events through the same pipeline that
	// the live gRPC stream uses. The TUI processes these events identically
	// to a live execution — single rendering path, zero parity drift.
	events := make(chan executiontui.Event, 256)
	approvalResponses := make(chan executiontui.ApprovalResponse, 1)
	go snapshotToEvents(chronological, events)

	// When the session subject is not yet known, provide a fetch function so
	// the TUI can update the header in-place once the backend generates a title.
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
	finalModel, err := p.Run()
	if err != nil {
		return errors.Wrap(err, "TUI session failed")
	}

	result := finalModel.(executiontui.Model)

	// Fetch the final execution state. When the user sent follow-ups,
	// LatestExecutionID returns the most recent one.
	finalExecID := result.LatestExecutionID()
	finalExec, err := fetchFinalExecution(ctx, conn, finalExecID)
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
