package root

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"google.golang.org/grpc"
)

// executeRunSession handles the single-arg `stigmer run ses-xxx` path.
// It connects to the backend and delegates to openSession.
func executeRunSession(sessionID, orgOverride string) error {
	conn, orgID, err := connectToBackend(orgOverride)
	if err != nil {
		return err
	}
	defer conn.Close()

	return openSession(sessionID, orgID, conn)
}

// openSession re-opens an existing session by its ID.
//
// It fetches the session, finds the latest execution, and either:
//   - Re-attaches to the live stream if the execution is still running
//   - Opens a read-only replay TUI if the execution has completed
func openSession(sessionID, orgID string, conn *grpc.ClientConn) error {
	ses, err := session.GetFromBackend(conn, sessionID)
	if err != nil {
		cliprint.PrintError("Session not found: %s", sessionID)
		return err
	}

	// List executions in this session to find the latest one.
	execList, err := execution.ListBySession(&execution.ListBySessionOptions{
		Conn:      conn,
		SessionID: sessionID,
		PageSize:  1,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list session executions")
	}

	entries := execList.GetEntries()
	if len(entries) == 0 {
		cliprint.PrintWarning("Session %s has no executions", sessionID)
		return nil
	}

	latestExec := entries[0]
	executionID := latestExec.GetMetadata().GetId()
	phase := latestExec.GetStatus().GetPhase()

	subject := ses.GetSpec().GetSubject()
	if subject != "" {
		cliprint.PrintInfo("Session: %s (%s)", sessionID, subject)
	} else {
		cliprint.PrintInfo("Session: %s", sessionID)
	}

	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		cliprint.PrintInfo("Re-attaching to session...")
		fmt.Println()
		prompter := approval.NewInteractivePrompter()
		_, err := streamAgentExecution(sessionID, executionID, orgID, prompter, approval.Action(0), conn)
		return err

	default:
		return replayAgentExecution(sessionID, executionID, conn)
	}
}

// replayAgentExecution opens a completed execution in read-only replay mode.
func replayAgentExecution(sessionID, executionID string, conn *grpc.ClientConn) error {
	cliprint.PrintInfo("Opening session replay...")
	fmt.Println()

	exec, err := execution.GetFromBackend(conn, executionID)
	if err != nil {
		return errors.Wrap(err, "failed to fetch execution")
	}

	blocks := executiontui.BuildReplayBlocks(exec)

	model := executiontui.NewReplay(executiontui.ReplayConfig{
		SessionID:   sessionID,
		ExecutionID: executionID,
		Blocks:      blocks,
	})

	p := tea.NewProgram(model, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		return errors.Wrap(err, "TUI replay failed")
	}

	displaySessionExitLine(sessionID, exec)
	return nil
}
