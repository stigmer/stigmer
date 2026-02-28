package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// localWorkspaceRoot extracts the absolute path from a local-path workspace source.
// Returns empty string for nil, git, or non-local workspace sources.
func localWorkspaceRoot(ws *sessionv1.WorkspaceSource) string {
	if ws == nil {
		return ""
	}
	lp := ws.GetLocalPath()
	if lp == nil {
		return ""
	}
	return lp.GetPath()
}

// NewRunCommand creates the unified run command for executing agents and workflows.
func NewRunCommand() *cobra.Command {
	var message string
	var envFlags []string
	var envFileFlags []string
	var secretFlags []string
	var secretFileFlags []string
	var orgOverride string
	var detach bool
	var attachFlags []string
	var downloadDir string
	var approveDefault string
	var verbose bool
	var workspaceFlag string
	var branchFlag string
	var commitFlag string

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

  --workspace URL|PATH    Workspace source for the agent (agents only)
                          HTTPS git URL or local filesystem path
  --branch NAME           Git branch to clone (default: repo default branch)
  --commit SHA            Git commit to checkout after cloning

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
  stigmer run agent code-reviewer --workspace . -m "Review my project"
  stigmer run agent refactorer --workspace ~/projects/my-app -m "Refactor the auth module"

  # Override organization
  stigmer run agent my-agent --org acme-corp`,
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
			// Single-arg session ID mode
			if len(args) == 1 {
				err := executeRunSession(args[0], orgOverride, verbose)
				clierr.Handle(err)
				return
			}
			err := executeRun(runOptions{
				TypeArg:         args[0],
				Reference:       args[1],
				Message:         message,
				EnvFlags:        envFlags,
				EnvFileFlags:    envFileFlags,
				SecretFlags:     secretFlags,
				SecretFileFlags: secretFileFlags,
				Detach:          detach,
				OrgOverride:     orgOverride,
				AttachFlags:     attachFlags,
				DownloadDir:     downloadDir,
				ApproveDefault:  approveDefault,
				Verbose:         verbose,
				WorkspaceFlag:   workspaceFlag,
				BranchFlag:      branchFlag,
				CommitFlag:      commitFlag,
			})
			clierr.Handle(err)
		},
	}

	// Message flag
	cmd.Flags().StringVarP(&message, "message", "m", "", "initial message/prompt for execution")

	// Environment variable flags (non-secrets)
	cmd.Flags().StringArrayVar(&envFlags, "env", []string{},
		"runtime environment variable (KEY=VALUE, can be repeated)")
	cmd.Flags().StringArrayVar(&envFileFlags, "env-file", []string{},
		"load environment from file (can be repeated, later files override earlier)")

	// Secret flags (encrypted)
	cmd.Flags().StringArrayVar(&secretFlags, "secret", []string{},
		"secret environment variable (KEY=VALUE, can be repeated, encrypted)")
	cmd.Flags().StringArrayVar(&secretFileFlags, "secret-file", []string{},
		"load secrets from file (can be repeated, all values encrypted)")

	// Execution flags
	cmd.Flags().BoolVar(&detach, "detach", false,
		"start execution and return immediately without streaming")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

	// Attachment flags
	cmd.Flags().StringArrayVar(&attachFlags, "attach", []string{},
		"file to attach as input (can be repeated)")

	// Download flag
	cmd.Flags().StringVar(&downloadDir, "download", "",
		"download artifacts to directory when complete")

	// Approval flag for non-interactive (CI/CD) usage
	cmd.Flags().StringVar(&approveDefault, "approve-default", "",
		"auto-resolve approval prompts in non-interactive mode (approve, skip, reject)")

	// Verbose flag for debugging
	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false,
		"show execution IDs and phase transitions in the TUI transcript")

	// Workspace flags (agents only)
	cmd.Flags().StringVar(&workspaceFlag, "workspace", "",
		"workspace source: HTTPS git URL or local filesystem path")
	cmd.Flags().StringVar(&branchFlag, "branch", "",
		"git branch to clone (only valid with git --workspace URL)")
	cmd.Flags().StringVar(&commitFlag, "commit", "",
		"git commit SHA to checkout (only valid with git --workspace URL)")

	return cmd
}

// runOptions contains options for the run command.
type runOptions struct {
	TypeArg         string
	Reference       string
	Message         string
	EnvFlags        []string
	EnvFileFlags    []string
	SecretFlags     []string
	SecretFileFlags []string
	Detach          bool
	OrgOverride     string
	AttachFlags     []string
	DownloadDir     string
	ApproveDefault  string
	Verbose         bool
	WorkspaceFlag   string
	BranchFlag      string
	CommitFlag      string
}

// executeRun validates type and routes to the appropriate run handler.
func executeRun(opts runOptions) error {
	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: agent, workflow", opts.TypeArg)
	}

	// Step 2: Check verb support
	if !info.SupportsVerb(types.VerbRun) {
		return formatUnsupportedVerbError(info, types.VerbRun)
	}

	// Step 3: Parse --approve-default flag (if set)
	var defaultAction approval.Action
	if opts.ApproveDefault != "" {
		var err error
		defaultAction, err = approval.ParseAction(opts.ApproveDefault)
		if err != nil {
			return errors.Wrap(err, "invalid --approve-default value")
		}
	}

	// Step 4: Parse workspace source from flags
	workspaceSource, err := parseWorkspaceSource(opts.WorkspaceFlag, opts.BranchFlag, opts.CommitFlag)
	if err != nil {
		return errors.Wrap(err, "invalid workspace configuration")
	}

	// Step 5: Load and merge user-provided environment variables
	runtimeEnv, err := envfile.LoadAndMergeWithSecrets(
		opts.EnvFileFlags,
		opts.SecretFileFlags,
		opts.EnvFlags,
		opts.SecretFlags,
	)
	if err != nil {
		return errors.Wrap(err, "failed to load environment")
	}

	// Step 5.5: Auto-resolve well-known credentials from local stores
	// (gh auth token, Planton CLI credentials, Stigmer CLI config).
	// Merged as the lowest priority — user-provided flags and env files
	// always take precedence.
	autoEnv, err := resolveAndMergeAutoEnv(runtimeEnv)
	if err != nil {
		log.Warn().Err(err).Msg("skipping auto-env resolution (config load failed)")
	} else {
		runtimeEnv = autoEnv
	}

	// Step 6: Connect to backend
	conn, orgID, err := connectToBackend(opts.OrgOverride)
	if err != nil {
		return err
	}
	defer conn.Close()

	// Step 7: Process attachments (workspace-aware)
	var attachResult AttachmentResult
	if len(opts.AttachFlags) > 0 {
		processor := NewAttachmentProcessor(conn)
		localRoot := localWorkspaceRoot(workspaceSource)
		res, err := processor.ProcessFiles(opts.AttachFlags, localRoot)
		if err != nil {
			return errors.Wrap(err, "failed to process attachments")
		}
		attachResult = *res
	}

	// Step 8: Route to appropriate handler
	return routeRun(info, opts.Reference, opts.Message, runtimeEnv, &attachResult, workspaceSource, opts.Detach, opts.DownloadDir, orgID, defaultAction, opts.Verbose, conn)
}

// resolveAndMergeAutoEnv loads the CLI config, resolves well-known
// credentials, and merges them with the user-provided env. Auto-resolved
// values are the lowest priority: user-provided values always win.
func resolveAndMergeAutoEnv(userEnv envfile.EnvMap) (envfile.EnvMap, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	autoEnv := mcpserver.ResolveWellKnownEnv(cfg)
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

// routeRun routes to the appropriate run handler based on kind.
func routeRun(info *types.TypeInfo, ref, message string, env envfile.EnvMap, attachResult *AttachmentResult, workspaceSource *sessionv1.WorkspaceSource, detach bool, downloadDir, orgID string, defaultAction approval.Action, verbose bool, conn *grpc.ClientConn) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return runAgent(ref, message, env, attachResult, workspaceSource, detach, downloadDir, orgID, defaultAction, verbose, conn)

	case apiresourcekind.ApiResourceKind_workflow:
		if workspaceSource != nil {
			return fmt.Errorf("--workspace is not supported for workflows (workspace is an agent-level concept)")
		}
		return runWorkflow(ref, message, env, detach, orgID, defaultAction, conn)

	default:
		return fmt.Errorf("run not implemented for %s", info.DisplayName)
	}
}
