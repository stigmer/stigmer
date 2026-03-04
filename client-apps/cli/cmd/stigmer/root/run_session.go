package root

import (
	"context"
	"os"
	"slices"

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
	renderSessionHeader(os.Stderr, sessionHeaderInfo{
		SessionID: sessionID,
		Subject:   subject,
	})

	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		executionID := latestExec.GetMetadata().GetId()
		prompter := approval.NewInlinePrompter(os.Stdin, os.Stderr)
		_, err := streamAgentExecution(sessionID, subject, executionID, orgID, prompter, approval.Action(0), verbose, outputMode, conn)
		return err

	default:
		return resumeSession(sessionID, subject, orgID, entries, verbose, outputMode, conn)
	}
}

// resumeSession opens a completed session with the full conversation history
// and allows the user to continue. Stored executions are converted into the
// same event stream (via snapshotToEvents), so noise suppression, lifecycle
// badges, and duplicate filtering all apply automatically. The follow-up
// prompt activates after all historical events are rendered.
func resumeSession(sessionID, sessionSubject, orgID string, executions []*agentexecutionv1.AgentExecution, verbose bool, outputMode OutputMode, conn *grpc.ClientConn) error {

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
		cfg := inlineRenderConfig{
			events:            events,
			approvalResponses: approvalResponses,
			prompter:          prompter,
			data:              os.Stdout,
			status:            os.Stderr,
			sessionID:         sessionID,
		}
		finalExecID, _, exitErr := runInlineFollowUpLoop(streamCtx, cfg, followUpFn, latestExecID)
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
