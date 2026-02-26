package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// draftSkillOptions contains options for the draft skill command.
type draftSkillOptions struct {
	Message        string
	AttachFlags    []string
	OutputDir      string
	Model          string
	ApproveDefault string
	AutoApprove    bool
	Verbose        bool
}

// executeDraftSkill handles the draft skill command by invoking the skill-creator agent.
//
// This is a convenience wrapper that:
// 1. Resolves the skill-creator agent from the active org (created by bootstrap)
// 2. Processes any attached files as context for the agent
// 3. Creates an agent execution with the user's message
// 4. Streams execution in real-time (handling approvals inline)
// 5. Downloads the generated skill artifacts on completion
func executeDraftSkill(opts draftSkillOptions) error {
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

	// 3. Resolve skill-creator agent (system agent created by bootstrap).
	agentRef := orgID + "/" + skillCreatorAgentName
	agent, err := resolveAgent(agentRef, orgID, conn)
	if err != nil {
		displaySkillCreatorNotFoundError()
		return errors.Wrap(err, "skill-creator agent not found")
	}

	climsg.Info("Using system agent: %s", agent.Metadata.Name)

	// 4. Process attachments (reuse existing AttachmentProcessor)
	var attachments []*agentexecutionv1.Attachment
	if len(opts.AttachFlags) > 0 {
		processor := NewAttachmentProcessor(conn)
		attachments, err = processor.ProcessFiles(opts.AttachFlags)
		if err != nil {
			return errors.Wrap(err, "failed to process attachments")
		}
		climsg.Info("Attached %d file(s) as context", len(attachments))
	}

	// 5. Create session and first execution.
	climsg.Info("Starting session...")
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

	climsg.Info("Session: %s", sessionID)
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
			return errors.Wrap(err, "failed to download skill artifacts")
		}
		climsg.Success("Skill saved to: %s", opts.OutputDir)
	} else {
		climsg.Warning("No skill artifacts were generated")
		climsg.Info("The agent may not have published any files. Check session logs with:")
		climsg.Info("  stigmer run %s", sessionID)
	}

	return nil
}

// displaySkillCreatorNotFoundError shows a helpful error when the skill-creator agent is missing.
func displaySkillCreatorNotFoundError() {
	climsg.Error("skill-creator agent not found")
	climsg.Info("")
	climsg.Info("This system agent is created during server bootstrap.")
	climsg.Info("Ensure the server has completed bootstrap successfully.")
	climsg.Info("")
	climsg.Info("Check bootstrap status with:")
	climsg.Info("  Check server logs for 'Seedpack bootstrap completed successfully'")
	fmt.Println()
}
