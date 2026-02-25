package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
)

// draftAgentOptions contains options for the draft agent command.
type draftAgentOptions struct {
	Message        string
	AttachFlags    []string
	OutputDir      string
	Model          string
	ApproveDefault string
	AutoApprove    bool
	Verbose        bool
}

// executeDraftAgent handles the draft agent command by invoking the agent-creator agent.
//
// This is a convenience wrapper that:
// 1. Resolves the agent-creator agent from the active org (created by bootstrap)
// 2. Processes any attached files as context for the agent
// 3. Creates an agent execution with the user's message
// 4. Streams execution in real-time (handling approvals inline)
// 5. Downloads the generated agent YAML on completion
func executeDraftAgent(opts draftAgentOptions) error {
	// 1. Parse --approve-default flag (if set)
	var defaultAction approval.Action
	if opts.ApproveDefault != "" {
		var err error
		defaultAction, err = approval.ParseAction(opts.ApproveDefault)
		if err != nil {
			return errors.Wrap(err, "invalid --approve-default value")
		}
	}

	// 2. Connect to backend
	conn, orgID, err := connectToBackend("")
	if err != nil {
		return err
	}
	defer conn.Close()

	// 3. Resolve agent-creator agent (system agent created by bootstrap).
	agentRef := orgID + "/" + agentCreatorAgentName
	agent, err := resolveAgent(agentRef, orgID, conn)
	if err != nil {
		displayAgentCreatorNotFoundError()
		return errors.Wrap(err, "agent-creator agent not found")
	}

	cliprint.PrintInfo("Using system agent: %s", agent.Metadata.Name)

	// 4. Process attachments (reuse existing AttachmentProcessor)
	var attachments []*agentexecutionv1.Attachment
	if len(opts.AttachFlags) > 0 {
		processor := NewAttachmentProcessor(conn)
		attachments, err = processor.ProcessFiles(opts.AttachFlags)
		if err != nil {
			return errors.Wrap(err, "failed to process attachments")
		}
		cliprint.PrintInfo("Attached %d file(s) as context", len(attachments))
	}

	// 5. Create session and first execution.
	cliprint.PrintInfo("Starting session...")
	exec, err := createAgentExecution(CreateAgentExecutionInput{
		AgentID:        agent.Metadata.Id,
		OrgID:          orgID,
		Message:        opts.Message,
		Attachments:    attachments,
		Model:          opts.Model,
		AutoApproveAll: opts.AutoApprove,
		Conn:           conn,
	})
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	sessionID := exec.GetSpec().GetSessionId()
	if sessionID == "" {
		log.Warn().
			Str("execution_id", exec.GetMetadata().GetId()).
			Msg("backend returned execution without session_id — session display may be degraded")
	}

	cliprint.PrintInfo("Session: %s", sessionID)
	fmt.Println()

	// 6. Stream execution in real-time until completion.
	prompter := approval.NewInteractivePrompter()
	exec, err = streamAgentExecution(sessionID, "", exec.Metadata.Id, orgID, prompter, defaultAction, opts.Verbose, conn)
	if err != nil {
		return errors.Wrap(err, "execution failed")
	}

	// 7. Download artifacts (draft commands always download).
	if len(exec.Status.Artifacts) > 0 {
		if err := downloadArtifacts(exec, opts.OutputDir, conn); err != nil {
			return errors.Wrap(err, "failed to download agent artifacts")
		}
		cliprint.PrintSuccess("Agent YAML saved to: %s", opts.OutputDir)
	} else {
		cliprint.PrintWarning("No agent artifacts were generated")
		cliprint.PrintInfo("The agent may not have published any files. Check session logs with:")
		cliprint.PrintInfo("  stigmer run %s", sessionID)
	}

	return nil
}

// displayAgentCreatorNotFoundError shows a helpful error when the agent-creator agent is missing.
func displayAgentCreatorNotFoundError() {
	cliprint.PrintError("agent-creator agent not found")
	cliprint.PrintInfo("")
	cliprint.PrintInfo("This system agent is created during server bootstrap.")
	cliprint.PrintInfo("Ensure the server has completed bootstrap successfully.")
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Check bootstrap status with:")
	cliprint.PrintInfo("  Check server logs for 'Seedpack bootstrap completed successfully'")
	fmt.Println()
}
