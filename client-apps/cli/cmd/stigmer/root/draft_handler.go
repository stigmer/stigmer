package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// draftConfig identifies which system agent to invoke and how to label
// user-facing messages. Each draft subcommand (skill, agent, ...) provides
// its own draftConfig while sharing the execution logic in executeDraft.
type draftConfig struct {
	AgentName    string // system agent slug, e.g. "skill-creator"
	ResourceType string // user-facing label, e.g. "Skill"
}

// draftOptions contains the draft-specific flags plus the shared agent
// execution flags. The embedded agentExecFlags provide workspace, env,
// detach, and all other options that `stigmer run agent` supports.
type draftOptions struct {
	agentExecFlags
	outputModeFlags
	OutputDir   string
	Model       string
	AutoApprove bool
}

// registerDraftFlags registers all draft flags: the shared agent execution
// flags plus the draft-specific ones (--output, --model, --auto-approve).
// The --message flag is marked as required for draft commands.
func registerDraftFlags(cmd *cobra.Command, opts *draftOptions, resourceType string) {
	registerAgentExecFlags(cmd, &opts.agentExecFlags)
	registerOutputModeFlags(cmd, &opts.outputModeFlags)
	cmd.MarkFlagRequired("message")

	cmd.Flags().StringVarP(&opts.OutputDir, "output", "o", ".",
		fmt.Sprintf("directory to save the generated %s", resourceType))

	cmd.Flags().StringVar(&opts.Model, "model", "",
		"LLM model to use (e.g., claude-sonnet-4-20250514)")

	cmd.Flags().BoolVar(&opts.AutoApprove, "auto-approve", false,
		"automatically approve all tool executions without prompting (bypasses approval policies)")
}

// executeDraft is the unified handler for all draft subcommands. It uses the
// shared preparation and agent execution layers, adding draft-specific
// behavior: the agent is a hardcoded system agent, and artifacts are always
// downloaded on completion (unless --detach).
func executeDraft(cfg draftConfig, opts draftOptions) error {
	prep, err := prepareAgentExec(opts.agentExecFlags)
	if err != nil {
		return err
	}
	prep.OutputMode = resolveOutputMode(opts.outputModeFlags)
	defer prep.Conn.Close()

	agentRef := prep.OrgID + "/" + cfg.AgentName
	agent, err := resolveAgent(agentRef, prep.OrgID, prep.Conn)
	if err != nil {
		displayDraftAgentNotFoundError(cfg.AgentName, prep.OrgID)
		return errors.Wrapf(err, "%s agent not found", cfg.AgentName)
	}

	climsg.Info("Using system agent: %s", agent.Metadata.Name)

	if len(prep.AttachResult.Attachments)+len(prep.AttachResult.WorkspaceFileRefs) > 0 {
		climsg.Info("Attached %d file(s) as context",
			len(prep.AttachResult.Attachments)+len(prep.AttachResult.WorkspaceFileRefs))
	}

	downloadDir := opts.OutputDir
	if opts.Detach {
		downloadDir = ""
	}

	err = executeResolvedAgent(resolvedAgentExecInput{
		Agent:           agent,
		Message:         prep.Message,
		RuntimeEnv:      prep.RuntimeEnv,
		AttachResult:    &prep.AttachResult,
		WorkspaceSource: prep.WorkspaceSource,
		Model:           opts.Model,
		AutoApproveAll:  opts.AutoApprove,
		Detach:          prep.Detach,
		DownloadDir:     downloadDir,
		OrgID:           prep.OrgID,
		DefaultAction:   prep.DefaultAction,
		Verbose:         prep.Verbose,
		OutputMode:      prep.OutputMode,
		Conn:            prep.Conn,
	})
	if err != nil {
		return err
	}

	return nil
}

// displayDraftAgentNotFoundError shows a helpful error when a draft system
// agent is missing, including the org that was searched and recovery steps.
func displayDraftAgentNotFoundError(agentName, orgID string) {
	climsg.Error("%s agent not found in organization %q", agentName, orgID)
	climsg.Info("")
	climsg.Info("This system agent is created during server bootstrap.")
	climsg.Info("")
	climsg.Info("Troubleshooting:")
	climsg.Info("  1. Verify agents exist:  stigmer list agents")
	climsg.Info("  2. Check active org:     stigmer context show")
	climsg.Info("  3. Re-bootstrap:         stigmer server reset && stigmer server")
	fmt.Println()
}
