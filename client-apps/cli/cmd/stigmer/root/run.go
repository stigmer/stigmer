package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"google.golang.org/grpc"
)

// NewRunCommand creates the unified run command for executing agents and workflows.
func NewRunCommand() *cobra.Command {
	var message string
	var envFlags []string
	var envFileFlags []string
	var secretFlags []string
	var secretFileFlags []string
	var orgOverride string
	var follow bool

	cmd := &cobra.Command{
		Use:   "run <type> <name-or-id>",
		Short: "Execute an agent or workflow",
		Long: `Execute a resource by type and name or ID.

The type can be specified using any alias:
  - agent, agt, agents
  - workflow, wf, workflows

The reference can be:
  - Resource ID (e.g., agt_abc123, wfl_xyz789)
  - Slug (e.g., my-agent)
  - Org/slug (e.g., acme-corp/my-agent)

ENVIRONMENT VARIABLES:

  --env KEY=VALUE         Runtime environment variable (can be repeated)
  --secret KEY=VALUE      Secret environment variable (can be repeated, encrypted)
  
  --env-file PATH         Load environment from file (can be repeated)
  --secret-file PATH      Load secrets from file (can be repeated, all values encrypted)

  Precedence (highest to lowest):
    1. --env and --secret flags (inline values)
    2. Later --env-file and --secret-file flags
    3. Earlier --env-file and --secret-file flags

OTHER OPTIONS:

  --message, -m:  Initial prompt to send to the agent/workflow
  --follow:       Stream execution logs in real-time (default: true)
                  Use --no-follow to skip streaming`,
		Example: `  # Run an agent by name
  stigmer run agent my-agent

  # Run a workflow with a message
  stigmer run workflow my-wf --message "Process the data"
  stigmer run workflow my-wf -m "Deploy to production"

  # Run by resource ID
  stigmer run agent agt_01kewqjbtdy0w4d14bnhhy4yc2
  stigmer run workflow wfl_01abc123xyz456

  # Run with org/slug format
  stigmer run agent acme-corp/code-reviewer

  # Run without streaming logs
  stigmer run agent my-agent --no-follow

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

  # Override organization
  stigmer run agent my-agent --org acme-corp`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeRun(runOptions{
				TypeArg:         args[0],
				Reference:       args[1],
				Message:         message,
				EnvFlags:        envFlags,
				EnvFileFlags:    envFileFlags,
				SecretFlags:     secretFlags,
				SecretFileFlags: secretFileFlags,
				Follow:          follow,
				OrgOverride:     orgOverride,
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
	cmd.Flags().BoolVar(&follow, "follow", true, "stream execution logs in real-time")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

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
	Follow          bool
	OrgOverride     string
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

	// Step 3: Load and merge environment variables
	runtimeEnv, err := envfile.LoadAndMergeWithSecrets(
		opts.EnvFileFlags,
		opts.SecretFileFlags,
		opts.EnvFlags,
		opts.SecretFlags,
	)
	if err != nil {
		return errors.Wrap(err, "failed to load environment")
	}

	// Step 4: Connect to backend
	conn, orgID, err := connectToBackend(opts.OrgOverride)
	if err != nil {
		return err
	}
	defer conn.Close()

	// Step 5: Route to appropriate handler
	return routeRun(info, opts.Reference, opts.Message, runtimeEnv, opts.Follow, orgID, conn)
}

// routeRun routes to the appropriate run handler based on kind.
func routeRun(info *types.TypeInfo, ref, message string, env envfile.EnvMap, follow bool, orgID string, conn *grpc.ClientConn) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return runAgent(ref, message, env, follow, orgID, conn)

	case apiresourcekind.ApiResourceKind_workflow:
		return runWorkflow(ref, message, env, follow, orgID, conn)

	default:
		return fmt.Errorf("run not implemented for %s", info.DisplayName)
	}
}
