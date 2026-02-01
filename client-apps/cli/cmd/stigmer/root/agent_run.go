package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
)

// newAgentRunCommand creates the agent run subcommand.
func newAgentRunCommand() *cobra.Command {
	var message string
	var envFlags []string
	var envFileFlags []string
	var secretFlags []string
	var secretFileFlags []string
	var follow bool
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "run <name-or-id>",
		Short: "Execute an agent",
		Long: `Execute an agent by name (slug) or resource ID.

The command creates an agent execution and optionally streams logs in real-time.
Use --message to provide an initial prompt for the agent.

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

  --message, -m:  Initial prompt to send to the agent
  --follow:       Stream execution logs in real-time (default: true)
                  Use --no-follow to skip streaming`,
		Example: `  # Run an agent by name
  stigmer agent run my-agent

  # Run with an initial message
  stigmer agent run my-agent --message "Analyze this codebase"
  stigmer agent run my-agent -m "Tell me a joke"

  # Run by resource ID
  stigmer agent run agt_01kewqjbtdy0w4d14bnhhy4yc2

  # Run with org/slug format
  stigmer agent run acme-corp/code-reviewer

  # Run without streaming logs
  stigmer agent run my-agent --no-follow

  # Run with environment variables
  stigmer agent run my-agent --env API_URL=https://api.example.com --env DEBUG=true

  # Run with secrets (encrypted)
  stigmer agent run my-agent --secret API_KEY=sk_live_xxx

  # Run with environment file
  stigmer agent run my-agent --env-file .env

  # Run with secret file
  stigmer agent run my-agent --secret-file .env.secrets

  # Combine env files and inline overrides
  stigmer agent run my-agent --env-file .env --secret-file .env.secrets --env DEBUG=true

  # Override organization
  stigmer agent run my-agent --org acme-corp`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			err := executeAgentRun(agentRunOptions{
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

// agentRunOptions contains options for the run operation.
type agentRunOptions struct {
	Reference       string
	Message         string
	EnvFlags        []string
	EnvFileFlags    []string
	SecretFlags     []string
	SecretFileFlags []string
	Follow          bool
	OrgOverride     string
}

// executeAgentRun orchestrates agent execution.
func executeAgentRun(opts agentRunOptions) error {
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

	// Step 3: Resolve agent by reference
	agent, err := resolveAgent(opts.Reference, orgID, conn)
	if err != nil {
		cliprint.PrintError("Agent not found: %s", opts.Reference)
		cliprint.PrintInfo("")
		cliprint.PrintInfo("Possible reasons:")
		cliprint.PrintInfo("  • Agent doesn't exist in organization")
		cliprint.PrintInfo("  • Agent hasn't been deployed yet (run: stigmer agent apply)")
		cliprint.PrintInfo("  • Wrong organization context (use --org to override)")
		fmt.Println()
		return err
	}

	// Step 4: Create agent execution
	cliprint.PrintInfo("Creating agent execution...")
	execution, err := createAgentExecution(agent.Metadata.Id, orgID, opts.Message, runtimeEnv, conn)
	if err != nil {
		return fmt.Errorf("failed to create execution: %w", err)
	}

	// Step 5: Display execution started
	cliprint.PrintSuccess("✓ Agent execution started: %s", agent.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	// Step 6: Stream logs if follow is enabled
	if opts.Follow {
		streamAgentExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer agent run %s --follow", agent.Metadata.Name)
		fmt.Println()
	}

	return nil
}
