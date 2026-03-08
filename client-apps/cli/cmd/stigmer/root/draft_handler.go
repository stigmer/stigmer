package root

import (
	"fmt"
	"os"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
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
// model, auto-approve, detach, and all other options that `stigmer run
// agent` supports.
type draftOptions struct {
	agentExecFlags
	outputModeFlags
	OutputDir string
}

// registerDraftFlags registers draft-specific flags on top of the shared
// agent execution flags. The --message flag is marked as required for draft
// commands. Model and auto-approve are inherited from agentExecFlags.
func registerDraftFlags(cmd *cobra.Command, opts *draftOptions, resourceType string) {
	registerAgentExecFlags(cmd, &opts.agentExecFlags)
	registerOutputModeFlags(cmd, &opts.outputModeFlags)
	cmd.MarkFlagRequired("message")

	cmd.Flags().StringVarP(&opts.OutputDir, "output", "o", "",
		"directory to save generated artifacts (default: current directory when no workspace is used)")
}

// executeDraft is the unified handler for all draft subcommands. It uses the
// shared preparation and agent execution layers, adding draft-specific
// behavior: the agent is a hardcoded system agent, and artifacts are
// downloaded on completion only when needed.
//
// Download logic:
//   - --detach: no download (execution is backgrounded)
//   - --output set explicitly: always download to that directory
//   - local workspaces present: skip download (agent writes directly to disk)
//   - otherwise: download to current directory (backward compatible default)
func executeDraft(cfg draftConfig, opts draftOptions) error {
	sp := spinner.New(os.Stderr)
	sp.Start("Preparing...")

	prep, err := prepareAgentExec(opts.agentExecFlags, sp)
	if err != nil {
		sp.Stop()
		return err
	}
	prep.OutputMode = resolveOutputMode(opts.outputModeFlags)
	defer prep.Conn.Close()

	sp.Update("Resolving agent...")
	agentRef := prep.OrgID + "/" + cfg.AgentName
	agent, err := resolveAgent(agentRef, prep.OrgID, prep.Conn)
	if err != nil {
		sp.Stop()
		displayDraftAgentNotFoundError(cfg.AgentName, prep.OrgID)
		return errors.Wrapf(err, "%s agent not found", cfg.AgentName)
	}

	runtimeEnv, err := applyAutoEnvForAgent(prep.RuntimeEnv, agent)
	if err != nil {
		log.Warn().Err(err).Msg("skipping auto-env resolution (config load failed)")
		runtimeEnv = prep.RuntimeEnv
	}
	prep.RuntimeEnv = runtimeEnv

	sp.Stop()

	if len(prep.AttachResult.Attachments)+len(prep.AttachResult.WorkspaceFileRefs) > 0 {
		climsg.Info("Attached %d file(s) as context",
			len(prep.AttachResult.Attachments)+len(prep.AttachResult.WorkspaceFileRefs))
	}

	downloadDir := opts.OutputDir
	switch {
	case opts.Detach:
		downloadDir = ""
	case downloadDir == "" && len(localWorkspaceRoots(prep.WorkspaceEntries)) > 0:
		// Agent writes directly to local workspaces; artifact download is redundant.
	case downloadDir == "":
		downloadDir = "."
	}

	return executeResolvedAgent(resolvedAgentExecInput{
		Agent:            agent,
		Message:          prep.Message,
		RuntimeEnv:       prep.RuntimeEnv,
		AttachResult:     &prep.AttachResult,
		WorkspaceEntries: prep.WorkspaceEntries,
		Model:            prep.Model,
		AutoApproveAll:   prep.AutoApproveAll,
		Detach:           prep.Detach,
		DownloadDir:      downloadDir,
		OrgID:            prep.OrgID,
		DefaultAction:    prep.DefaultAction,
		Verbose:          prep.Verbose,
		OutputMode:       prep.OutputMode,
		Conn:             prep.Conn,
	}, sp)
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
	climsg.Info("  2. Check active org:     stigmer config context show")
	climsg.Info("  3. Re-bootstrap:         stigmer server reset && stigmer server")
	fmt.Println()
}
