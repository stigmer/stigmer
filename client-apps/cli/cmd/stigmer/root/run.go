package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
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
	var detach bool
	var attachFlags []string
	var downloadDir string
	var approveDefault string

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

OTHER OPTIONS:

  --message, -m:  Initial prompt to send to the agent/workflow
  --detach:       Start execution and return immediately without streaming
  --download DIR: Download artifacts to directory when complete`,
		Example: `  # Run an agent by name (streams by default)
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
				Detach:          detach,
				OrgOverride:     orgOverride,
				AttachFlags:     attachFlags,
				DownloadDir:     downloadDir,
				ApproveDefault:  approveDefault,
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

	// Step 4: Load and merge environment variables
	runtimeEnv, err := envfile.LoadAndMergeWithSecrets(
		opts.EnvFileFlags,
		opts.SecretFileFlags,
		opts.EnvFlags,
		opts.SecretFlags,
	)
	if err != nil {
		return errors.Wrap(err, "failed to load environment")
	}

	// Step 5: Connect to backend
	conn, orgID, err := connectToBackend(opts.OrgOverride)
	if err != nil {
		return err
	}
	defer conn.Close()

	// Step 6: Process attachments
	var attachments []*agentexecutionv1.Attachment
	if len(opts.AttachFlags) > 0 {
		processor := NewAttachmentProcessor(conn)
		attachments, err = processor.ProcessFiles(opts.AttachFlags)
		if err != nil {
			return errors.Wrap(err, "failed to process attachments")
		}
	}

	// Step 7: Route to appropriate handler
	return routeRun(info, opts.Reference, opts.Message, runtimeEnv, attachments, opts.Detach, opts.DownloadDir, orgID, defaultAction, conn)
}

// routeRun routes to the appropriate run handler based on kind.
func routeRun(info *types.TypeInfo, ref, message string, env envfile.EnvMap, attachments []*agentexecutionv1.Attachment, detach bool, downloadDir, orgID string, defaultAction approval.Action, conn *grpc.ClientConn) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return runAgent(ref, message, env, attachments, detach, downloadDir, orgID, defaultAction, conn)

	case apiresourcekind.ApiResourceKind_workflow:
		return runWorkflow(ref, message, env, detach, orgID, defaultAction, conn)

	default:
		return fmt.Errorf("run not implemented for %s", info.DisplayName)
	}
}
