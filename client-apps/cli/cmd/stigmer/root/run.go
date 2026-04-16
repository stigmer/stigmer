package root

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// localWorkspaceRoots extracts the absolute paths from all local-path workspace
// entries. Git entries are skipped (they have no local root). Returns nil when
// there are no local-path entries.
func localWorkspaceRoots(entries []*sessionv1.WorkspaceEntry) []string {
	var roots []string
	for _, entry := range entries {
		if lp := entry.GetSource().GetLocalPath(); lp != nil {
			if p := lp.GetPath(); p != "" {
				roots = append(roots, p)
			}
		}
	}
	return roots
}

// sessionPaths computes the sandbox root and platform directory for a session.
// These directories may not exist yet (session still starting); callers use
// stat-probes so missing directories result in graceful degradation.
func sessionPaths(sessionID string) (sandboxRoot, platformDir string) {
	if sessionID == "" {
		return "", ""
	}
	configDir, err := config.GetConfigDir()
	if err != nil {
		return "", ""
	}
	dataDir := filepath.Join(configDir, config.DefaultDataDir)
	sandboxRoot = filepath.Join(dataDir, "workspace", "sessions", sessionID)
	platformDir = filepath.Join(configDir, "sessions", sessionID, "platform")
	return
}

// NewRunCommand creates the run command for executing agents and workflows.
func NewRunCommand() *cobra.Command {
	var opts runOptions

	cmd := &cobra.Command{
		Use:   "run [agent-ref | <type> <slug-or-id>]",
		Short: "Execute an agent or workflow",
		Long: `Execute an agent or workflow by reference, or browse agents interactively.

USAGE FORMS:

  stigmer run                         Browse and select an agent interactively
  stigmer run <agent-ref>             Resolve agent by slug, org/slug, or ID
  stigmer run <type> <slug-or-id>     Explicit type + reference (backward-compatible)

The single-argument form resolves agents by default. If the reference does
not match an agent exactly, an interactive search picker is shown.

For workflows, use the explicit two-argument form:
  stigmer run workflow <slug-or-id>

To resume a session, use the dedicated resume command:
  stigmer resume <session-id>

ENVIRONMENT VARIABLES:

  --env KEY=VALUE         Runtime environment variable (can be repeated)
  --secret KEY=VALUE      Secret environment variable (can be repeated, encrypted)

  --env-file PATH         Load environment from file (can be repeated)
  --secret-file PATH      Load secrets from file (can be repeated, all values encrypted)

  Precedence (highest to lowest):
    1. --env and --secret flags (inline values)
    2. Later --env-file and --secret-file flags
    3. Earlier --env-file and --secret-file flags

INPUT FILES:

  --attach PATH           Attach a file as input (can be repeated)
                          Files < 4MB: embedded inline
                          Files >= 4MB: uploaded to artifact store

WORKSPACE:

  --workspace, -w URL|PATH  Workspace source for the agent (can be repeated)
                            HTTPS git URL or local filesystem path
  --branch NAME             Git branch to clone (default: repo default branch)
  --commit SHA              Git commit to checkout after cloning

  Multiple --workspace flags create a multi-root workspace (VS Code model).
  --branch and --commit apply only when a single git workspace is provided.

OUTPUT MODES:

  --json:     Stream events as newline-delimited JSON (for scripting/CI)

  Output streams inline to the terminal by default.
  Use --json for machine-readable output in scripts and CI.

EXECUTION OPTIONS:

  --model MODEL:    LLM model to use (e.g., claude-sonnet-4-20250514)
  --auto-approve:   Automatically approve all tool executions without prompting

OTHER OPTIONS:

  --message, -m:  Initial prompt to send to the agent/workflow
  --detach:       Start execution and return immediately without streaming
  --download DIR: Download artifacts to directory when complete`,
		Example: `  # Browse agents interactively
  stigmer run

  # Run an agent by slug (agent is the default type)
  stigmer run my-agent
  stigmer run acme-corp/code-reviewer

  # Run an agent by ID
  stigmer run agt_01kewqjbtdy0w4d14bnhhy4yc2

  # Search agents interactively with initial query
  stigmer run deploy

  # Explicit type + reference (backward-compatible)
  stigmer run agent my-agent
  stigmer run workflow my-wf --message "Process the data"

  # Run with a message
  stigmer run my-agent -m "Review this code"

  # Start execution and return immediately (fire-and-forget)
  stigmer run my-agent --detach

  # Run with environment variables
  stigmer run my-agent --env API_URL=https://api.example.com --env DEBUG=true

  # Run with secrets (encrypted)
  stigmer run my-agent --secret API_KEY=sk_live_xxx

  # Run with environment and secret files
  stigmer run my-agent --env-file .env --secret-file .env.secrets

  # Run with file attachments
  stigmer run data-analyzer --attach ./data.csv -m "Analyze"

  # Run with a git workspace
  stigmer run code-reviewer --workspace https://github.com/acme/app -m "Review"

  # Run with a local workspace
  stigmer run code-reviewer -w . -m "Review my project"

  # Run with a specific model
  stigmer run my-agent --model claude-opus-4.6 -m "Analyze"

  # Run with auto-approval for all tool executions
  stigmer run my-agent --auto-approve -m "Deploy to staging"

  # Stream events as JSON for scripting
  stigmer run my-agent --json | jq '.payload.content'`,
		Args: cobra.RangeArgs(0, 2),
		Run: func(cmd *cobra.Command, args []string) {
			opts.OrgOverride = GetOrgFlag(cmd)
			outputMode := resolveOutputMode(opts.outputModeFlags)
			switch len(args) {
			case 0:
				clierr.Handle(executeRunInteractive(opts, outputMode))
			case 1:
				clierr.Handle(executeRunSmart(args[0], opts, outputMode))
			case 2:
				opts.TypeArg = args[0]
				opts.Reference = args[1]
				clierr.Handle(executeRun(opts, outputMode))
			}
		},
	}

	registerAgentExecFlags(cmd, &opts.agentExecFlags)
	registerOutputModeFlags(cmd, &opts.outputModeFlags)

	cmd.Flags().StringVar(&opts.DownloadDir, "download", "",
		"download artifacts to directory when complete")

	return cmd
}

// runOptions contains the run-command-specific options plus the shared
// agent execution flags.
type runOptions struct {
	agentExecFlags
	outputModeFlags
	TypeArg     string
	Reference   string
	DownloadDir string
}

// executeRun validates the resource type and delegates to the shared
// preparation + execution layers.
func executeRun(opts runOptions, outputMode OutputMode) error {
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: agent, workflow", opts.TypeArg)
	}

	if !info.SupportsVerb(types.VerbRun) {
		return formatUnsupportedVerbError(info, types.VerbRun)
	}

	sp := spinner.New(os.Stderr)
	sp.Start("Preparing...")

	prep, err := prepareAgentExec(opts.agentExecFlags, sp)
	if err != nil {
		sp.Stop()
		return err
	}
	prep.OutputMode = outputMode
	defer prep.Client.Close()

	return routeRun(info, opts.Reference, opts.DownloadDir, prep, sp)
}

// routeRun routes to the appropriate handler based on resource kind.
// The spinner is active on entry — each branch is responsible for updating
// or stopping it as appropriate.
func routeRun(info *types.TypeInfo, ref, downloadDir string, prep *preparedAgentExec, sp *spinner.Spinner) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		sp.Update("Resolving agent...")
		agent, err := resolveAgent(ref, prep.OrgID, prep.Client)
		if err != nil {
			sp.Stop()
			displayAgentNotFoundError(ref)
			return err
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
			Client:           prep.Client,
		}, sp)

	case apiresourcekind.ApiResourceKind_workflow:
		sp.Stop()
		if len(prep.WorkspaceEntries) > 0 {
			return fmt.Errorf("--workspace is not supported for workflows (workspace is an agent-level concept)")
		}
		return runWorkflow(ref, prep)

	default:
		sp.Stop()
		return fmt.Errorf("run not implemented for %s", info.DisplayName)
	}
}
