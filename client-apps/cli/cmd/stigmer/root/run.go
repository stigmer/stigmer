package root

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
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

// NewRunCommand creates the unified run command for executing agents and workflows.
func NewRunCommand() *cobra.Command {
	var opts runOptions

	cmd := &cobra.Command{
		Use:   "run {<type> <name-or-id> | <session-id>}",
		Short: "Execute an agent or workflow, or re-open a session",
		Long: `Execute a resource by type and name or ID, or re-open an existing session.

USAGE FORMS:

  stigmer run <type> <name-or-id>     Start a new execution
  stigmer run <session-id>            Re-open an existing session

The type can be specified using any alias:
  - agent, agt, agents
  - workflow, wf, workflows

The reference can be:
  - Resource ID (e.g., agt_abc123, wfl_xyz789)
  - Slug (e.g., my-agent)
  - Org/slug (e.g., acme-corp/my-agent)

A session ID (ses-xxx) re-opens that session: if the latest execution is
still running, you re-attach to the live stream; if it has completed, you
see the full conversation and can send follow-up messages to continue.

By default, the command streams execution updates in real-time, handles
approval prompts interactively, and returns when the execution completes.

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

OTHER OPTIONS:

  --message, -m:  Initial prompt to send to the agent/workflow
  --detach:       Start execution and return immediately without streaming
  --download DIR: Download artifacts to directory when complete`,
		Example: `  # Re-open an existing session
  stigmer run ses-01abc123xyz456

  # Run an agent by name (streams by default)
  stigmer run agent my-agent

  # Run a workflow with a message
  stigmer run workflow my-wf --message "Process the data"
  stigmer run workflow my-wf -m "Deploy to production"

  # Run by resource ID
  stigmer run agent agt_01kewqjbtdy0w4d14bnhhy4yc2
  stigmer run workflow wfl_01abc123xyz456

  # Run with org/slug format
  stigmer run agent acme-corp/code-reviewer

  # Start execution and return immediately (fire-and-forget)
  stigmer run agent my-agent --detach

  # Run with environment variables
  stigmer run agent my-agent --env API_URL=https://api.example.com --env DEBUG=true

  # Run with secrets (encrypted)
  stigmer run agent my-agent --secret API_KEY=sk_live_xxx

  # Run with environment file
  stigmer run agent my-agent --env-file .env

  # Run with secret file
  stigmer run agent my-agent --secret-file .env.secrets

  # Combine env files and inline overrides
  stigmer run agent my-agent --env-file .env --secret-file .env.secrets --env DEBUG=true

  # Run with file attachments
  stigmer run agent data-analyzer --attach ./data.csv --attach ./config.yaml -m "Analyze"

  # Stream execution and download artifacts when complete
  stigmer run agent report-generator --attach ./data.csv --download ./results

  # Run with a git workspace (agent clones and operates on the repo)
  stigmer run agent code-reviewer --workspace https://github.com/acme/app -m "Review this repo"

  # Run with a specific branch
  stigmer run agent code-reviewer --workspace https://github.com/acme/app --branch feature/auth

  # Run with a local workspace (agent operates directly on your files)
  stigmer run agent code-reviewer -w . -m "Review my project"
  stigmer run agent refactorer -w ~/projects/my-app -m "Refactor the auth module"

  # Run with multiple workspaces (multi-root)
  stigmer run agent code-reviewer -w ./frontend -w ./backend -m "Review both"

  # Override organization
  stigmer run agent my-agent --org acme-corp

  # Stream events as JSON for scripting
  stigmer run agent my-agent --json | jq '.payload.content'

  # Pipe output (auto-detects non-TTY, uses inline mode)
  stigmer run agent my-agent -m "explain this" | cat`,
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				if !reference.IsSessionID(args[0]) {
					return fmt.Errorf("single argument must be a session ID (ses-xxx); for agents use: stigmer run agent <name>")
				}
				return nil
			}
			if len(args) == 2 {
				return nil
			}
			return fmt.Errorf("accepts 1 or 2 args, received %d", len(args))
		},
		Run: func(cmd *cobra.Command, args []string) {
			opts.OrgOverride = GetOrgFlag(cmd)
			outputMode := resolveOutputMode(opts.outputModeFlags)
			if len(args) == 1 {
				err := executeRunSession(args[0], opts.OrgOverride, opts.Verbose, outputMode)
				clierr.Handle(err)
				return
			}
			opts.TypeArg = args[0]
			opts.Reference = args[1]
			clierr.Handle(executeRun(opts, outputMode))
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
	defer prep.Conn.Close()

	return routeRun(info, opts.Reference, opts.DownloadDir, prep, sp)
}

// resolveAndMergeAutoEnv loads the CLI config, resolves well-known
// credentials, and merges them with the user-provided env. Auto-resolved
// values are the lowest priority: user-provided values always win.
func resolveAndMergeAutoEnv(userEnv envfile.EnvMap) (envfile.EnvMap, error) {
	return resolveAndMergeAutoEnvScoped(userEnv, nil)
}

// resolveAndMergeAutoEnvScoped loads the CLI config and resolves only the
// well-known credentials that appear in requiredVars. When requiredVars is
// nil, all well-known vars are resolved (same as resolveAndMergeAutoEnv).
// Auto-resolved values are the lowest priority: user-provided values always win.
func resolveAndMergeAutoEnvScoped(userEnv envfile.EnvMap, requiredVars map[string]bool) (envfile.EnvMap, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	var autoEnv envfile.EnvMap
	if requiredVars != nil {
		autoEnv = mcpserver.ResolveWellKnownEnvScoped(cfg, requiredVars)
	} else {
		autoEnv = mcpserver.ResolveWellKnownEnv(cfg)
	}
	if len(autoEnv) == 0 {
		return userEnv, nil
	}

	var names []string
	for name := range autoEnv {
		names = append(names, name)
	}
	log.Debug().Strs("vars", names).Msg("auto-resolved credentials for MCP servers")

	return envfile.MergeEnvSources(autoEnv, userEnv), nil
}

// routeRun routes to the appropriate handler based on resource kind.
// The spinner is active on entry — each branch is responsible for updating
// or stopping it as appropriate.
func routeRun(info *types.TypeInfo, ref, downloadDir string, prep *preparedAgentExec, sp *spinner.Spinner) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		sp.Update("Resolving agent...")
		agent, err := resolveAgent(ref, prep.OrgID, prep.Conn)
		if err != nil {
			sp.Stop()
			displayAgentNotFoundError(ref)
			return err
		}

		runtimeEnv, err := applyAutoEnvForAgent(prep.RuntimeEnv, agent)
		if err != nil {
			log.Warn().Err(err).Msg("skipping auto-env resolution (config load failed)")
			runtimeEnv = prep.RuntimeEnv
		}

		return executeResolvedAgent(resolvedAgentExecInput{
			Agent:            agent,
			Message:          prep.Message,
			RuntimeEnv:       runtimeEnv,
			AttachResult:     &prep.AttachResult,
			WorkspaceEntries: prep.WorkspaceEntries,
			Detach:           prep.Detach,
			DownloadDir:      downloadDir,
			OrgID:            prep.OrgID,
			DefaultAction:    prep.DefaultAction,
			Verbose:          prep.Verbose,
			OutputMode:       prep.OutputMode,
			Conn:             prep.Conn,
		}, sp)

	case apiresourcekind.ApiResourceKind_workflow:
		sp.Stop()
		if len(prep.WorkspaceEntries) > 0 {
			return fmt.Errorf("--workspace is not supported for workflows (workspace is an agent-level concept)")
		}
		if autoEnv, err := resolveAndMergeAutoEnv(prep.RuntimeEnv); err != nil {
			log.Warn().Err(err).Msg("skipping auto-env resolution (config load failed)")
		} else {
			prep.RuntimeEnv = autoEnv
		}
		return runWorkflow(ref, prep)

	default:
		sp.Stop()
		return fmt.Errorf("run not implemented for %s", info.DisplayName)
	}
}
