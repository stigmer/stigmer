package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
)

// newWorkflowRunCommand creates the workflow run subcommand.
func newWorkflowRunCommand() *cobra.Command {
	var message string
	var envFlags []string
	var envFileFlags []string
	var secretFlags []string
	var secretFileFlags []string
	var follow bool
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "run <name-or-id>",
		Short: "Execute a workflow",
		Long: `Execute a workflow by name (slug) or resource ID.

The command creates a workflow execution and optionally streams logs in real-time.
Use --message to provide an initial trigger message for the workflow.

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

  --message, -m:  Initial trigger message for the workflow
  --follow:       Stream execution logs in real-time (default: true)
                  Use --no-follow to skip streaming`,
		Example: `  # Run a workflow by name
  stigmer workflow run my-workflow

  # Run with an initial message
  stigmer workflow run my-workflow --message "Process the data"
  stigmer workflow run my-workflow -m "Deploy to production"

  # Run by resource ID
  stigmer workflow run wfl_01kewqjbtdy0w4d14bnhhy4yc2

  # Run with org/slug format
  stigmer workflow run acme-corp/data-pipeline

  # Run without streaming logs
  stigmer workflow run my-workflow --no-follow

  # Run with environment variables
  stigmer workflow run my-workflow --env API_URL=https://api.example.com --env DEBUG=true

  # Run with secrets (encrypted)
  stigmer workflow run my-workflow --secret API_KEY=sk_live_xxx

  # Run with environment file
  stigmer workflow run my-workflow --env-file .env

  # Run with secret file
  stigmer workflow run my-workflow --secret-file .env.secrets

  # Combine env files and inline overrides
  stigmer workflow run my-workflow --env-file .env --secret-file .env.secrets --env DEBUG=true

  # Override organization
  stigmer workflow run my-workflow --org acme-corp

  # Use the 'wf' alias for brevity
  stigmer wf run my-workflow`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			err := executeWorkflowRun(workflowRunOptions{
				Reference:       reference,
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
	cmd.Flags().StringVarP(&message, "message", "m", "", "initial trigger message for execution")

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

// workflowRunOptions contains options for the run operation.
type workflowRunOptions struct {
	Reference       string
	Message         string
	EnvFlags        []string
	EnvFileFlags    []string
	SecretFlags     []string
	SecretFileFlags []string
	Follow          bool
	OrgOverride     string
}

// executeWorkflowRun orchestrates workflow execution.
func executeWorkflowRun(opts workflowRunOptions) error {
	// Step 1: Load and merge environment variables
	runtimeEnv, err := envfile.LoadAndMergeWithSecrets(
		opts.EnvFileFlags,
		opts.SecretFileFlags,
		opts.EnvFlags,
		opts.SecretFlags,
	)
	if err != nil {
		return fmt.Errorf("failed to load environment: %w", err)
	}

	// Step 2: Connect to backend
	conn, orgID, err := connectToBackend(opts.OrgOverride)
	if err != nil {
		return err
	}
	defer conn.Close()

	// Step 3: Resolve workflow by reference
	workflow, err := resolveWorkflow(opts.Reference, orgID, conn)
	if err != nil {
		cliprint.PrintError("Workflow not found: %s", opts.Reference)
		cliprint.PrintInfo("")
		cliprint.PrintInfo("Possible reasons:")
		cliprint.PrintInfo("  • Workflow doesn't exist in organization")
		cliprint.PrintInfo("  • Workflow hasn't been deployed yet (run: stigmer apply)")
		cliprint.PrintInfo("  • Wrong organization context (use --org to override)")
		fmt.Println()
		return err
	}

	// Step 4: Create workflow execution
	cliprint.PrintInfo("Creating workflow execution...")
	execution, err := createWorkflowExecution(workflow.Metadata.Id, orgID, opts.Message, runtimeEnv, conn)
	if err != nil {
		return fmt.Errorf("failed to create execution: %w", err)
	}

	// Step 5: Display execution started
	cliprint.PrintSuccess("✓ Workflow execution started: %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	// Step 6: Stream logs if follow is enabled
	if opts.Follow {
		streamWorkflowExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer workflow run %s --follow", workflow.Metadata.Name)
		fmt.Println()
	}

	return nil
}
