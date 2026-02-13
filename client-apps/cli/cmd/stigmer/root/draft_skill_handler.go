package root

import (
	"fmt"

	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

// draftSkillOptions contains options for the draft skill command.
type draftSkillOptions struct {
	Message     string
	AttachFlags []string
	OutputDir   string
	Follow      bool
	Model       string
}

// executeDraftSkill handles the draft skill command by invoking the skill-creator-agent.
//
// This is a convenience wrapper that:
// 1. Resolves the skill-creator-agent from the local org (created by bootstrap)
// 2. Processes any attached files as context for the agent
// 3. Creates an agent execution with the user's message
// 4. Waits for completion and downloads the generated skill artifacts
func executeDraftSkill(opts draftSkillOptions) error {
	// 1. Connect to backend
	conn, orgID, err := connectToBackend("")
	if err != nil {
		return err
	}
	defer conn.Close()

	// 2. Resolve skill-creator-agent (system agent in "local" org)
	// Bootstrap creates system agents in the "local" organization for single-tenant local mode.
	// We use the agent name directly with the local org.
	agentRef := skillCreatorAgentOrg + "/" + skillCreatorAgentName
	agent, err := resolveAgent(agentRef, skillCreatorAgentOrg, conn)
	if err != nil {
		displaySkillCreatorNotFoundError()
		return errors.Wrap(err, "skill-creator-agent not found")
	}

	cliprint.PrintInfo("Using system agent: %s", agent.Metadata.Name)

	// 3. Process attachments (reuse existing AttachmentProcessor)
	var attachments []*agentexecutionv1.Attachment
	if len(opts.AttachFlags) > 0 {
		processor := NewAttachmentProcessor(conn)
		attachments, err = processor.ProcessFiles(opts.AttachFlags)
		if err != nil {
			return errors.Wrap(err, "failed to process attachments")
		}
		cliprint.PrintInfo("Attached %d file(s) as context", len(attachments))
	}

	// 4. Create execution
	cliprint.PrintInfo("Invoking skill-creator-agent...")
	exec, err := createAgentExecution(agent.Metadata.Id, orgID, opts.Message, nil, attachments, opts.Model, conn)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}
	cliprint.PrintInfo("Execution ID: %s", exec.Metadata.Id)
	fmt.Println()

	// 5. Stream logs if follow is enabled (non-blocking observation)
	// Note: This runs in the background while we wait for completion
	if opts.Follow {
		go streamAgentExecutionLogs(exec.Metadata.Id, conn)
	}

	// 6. Wait for completion (draft commands always wait)
	exec, err = waitForExecution(exec.Metadata.Id, conn)
	if err != nil {
		return errors.Wrap(err, "execution failed")
	}

	// 7. Display result
	displayExecutionResult(exec)

	// 8. Download artifacts (draft commands always download)
	if len(exec.Status.Artifacts) > 0 {
		if err := downloadArtifacts(exec, opts.OutputDir, conn); err != nil {
			return errors.Wrap(err, "failed to download skill artifacts")
		}
		cliprint.PrintSuccess("Skill saved to: %s", opts.OutputDir)
	} else {
		cliprint.PrintWarning("No skill artifacts were generated")
		cliprint.PrintInfo("The agent may not have published any files. Check execution logs with:")
		cliprint.PrintInfo("  stigmer get execution %s", exec.Metadata.Id)
	}

	return nil
}

// displaySkillCreatorNotFoundError shows a helpful error when the skill-creator-agent is missing.
func displaySkillCreatorNotFoundError() {
	cliprint.PrintError("skill-creator-agent not found")
	cliprint.PrintInfo("")
	cliprint.PrintInfo("This system agent is created during server bootstrap.")
	cliprint.PrintInfo("Ensure the server has completed bootstrap successfully.")
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Check bootstrap status with:")
	cliprint.PrintInfo("  Check server logs for 'Seedpack bootstrap completed successfully'")
	fmt.Println()
}
