package root

import (
	"context"
	"fmt"
	"os"
	"slices"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
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

	return openSession(sessionID, orgID, verbose, outputMode, client, sp)
}

// openSession re-opens an existing session by its ID.
//
// It fetches the session, finds the latest execution, and either:
//   - Re-attaches to the live stream if the execution is still running
//   - Resumes with the full conversation history if all executions have
//     completed, allowing the user to continue
//
// The spinner is active on entry and stopped after session data is loaded.
func openSession(sessionID, orgID string, verbose bool, outputMode OutputMode, client *stigmer.Client, sp *spinner.Spinner) error {
	sp.Update("Loading session...")
	ses, err := session.GetFromBackend(client, sessionID)
	if err != nil {
		sp.Stop()
		climsg.Error("Session not found: %s", sessionID)
		return err
	}

	sp.Update("Loading session history...")
	execList, err := execution.ListBySession(&execution.ListBySessionOptions{
		Client:    client,
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
		_, err := streamAgentExecution(sessionID, headerInfo, executionID, orgID, prompter, approval.Action(0), verbose, outputMode, client, wsRoots, os.Stdout, os.Stderr)
		return err

	default:
		return resumeSession(sessionID, headerInfo, orgID, entries, verbose, outputMode, client, wsRoots)
	}
}

// resumeSession opens a completed session with the full conversation history
// and allows the user to continue. Stored executions are converted into the
// same event stream (via snapshotToEvents), so noise suppression, lifecycle
// badges, and duplicate filtering all apply automatically. The follow-up
// prompt activates after all historical events are rendered.
func resumeSession(sessionID string, headerInfo sessionHeaderInfo, orgID string, executions []*agentexecutionv1.AgentExecution, verbose bool, outputMode OutputMode, client *stigmer.Client, workspaceRoots []string) error {
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
		streamCancel()

		if termctl.IsSupported(os.Stderr) {
			// Interactive TTY: delegate to Ink, which loads the
			// session history and allows follow-up via its own hooks.
			_, err := streamAgentInk(sessionID, headerInfo, latestExecID, orgID, client)
			if err != nil {
				return errors.Wrap(err, "ink renderer failed")
			}
		} else {
			// Non-TTY: drain historical events as plain text, then exit.
			for event := range events {
				switch e := event.(type) {
				case executiontui.AIMessageEvent:
					if e.Content != "" {
						fmt.Fprintln(os.Stdout, e.Content)
					}
				case executiontui.HumanMessageEvent:
					fmt.Fprintf(os.Stderr, "\n> %s\n\n", e.Content)
				case executiontui.SystemMessageEvent:
					fmt.Fprintf(os.Stderr, "[system] %s\n", e.Content)
				}
			}
		}

		return nil
	}
}
