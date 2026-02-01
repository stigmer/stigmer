package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
)

// NewRunCommand creates the run command for executing agents and workflows
func NewRunCommand() *cobra.Command {
	var message string
	var envFlags []string
	var envFileFlags []string
	var secretFlags []string
	var secretFileFlags []string
	var orgOverride string
	var follow bool

	cmd := &cobra.Command{
		Use:   "run [agent-or-workflow-name-or-id]",
		Short: "Execute an agent or workflow",
		Long: `Execute an agent or workflow by name/ID or from your project directory.

TWO MODES:

1. AUTO-DISCOVERY MODE (no arguments):
   Automatically discovers and deploys agents/workflows from your Stigmer project.
   If multiple resources found, prompts you to select which one to run.
   
   Example: 
     stigmer run

2. REFERENCE MODE (with agent/workflow name or ID):
   Run a specific agent or workflow by name (slug) or ID.
   If in a project directory (has Stigmer.yaml), applies latest code first.
   If outside project directory, runs the deployed resource directly.
   
   Examples:
     stigmer run my-agent           # Agent by name
     stigmer run my-workflow        # Workflow by name  
     stigmer run agt_01abc123       # Agent by ID
     stigmer run wf_01xyz789        # Workflow by ID

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

  --message:      Initial prompt to send to the agent/workflow
  --follow:       Stream execution logs in real-time (default: true)
                  Use --no-follow to skip streaming`,
		Example: `  # AUTO-DISCOVERY: Discover, deploy, and run from project
  stigmer run
  stigmer run --message "Execute with this prompt"
  
  # REFERENCE: Run specific agent (applies latest code if in project)
  stigmer run my-agent
  stigmer run my-agent --message "Tell me a joke"
  
  # REFERENCE: Run specific workflow
  stigmer run my-workflow
  stigmer run my-workflow --message "Process data"
  
  # Run without log streaming
  stigmer run my-agent --no-follow
  
  # Run with inline environment variables
  stigmer run my-agent --env API_URL=https://api.example.com --env DEBUG=true
  
  # Run with inline secrets (encrypted)
  stigmer run my-agent --secret DB_PASSWORD=supersecret --secret API_KEY=ghp_abc123
  
  # Run with environment file (all values are non-secrets)
  stigmer run my-agent --env-file .env
  stigmer run my-agent --env-file .env.defaults --env-file .env.local
  
  # Run with secret file (all values are encrypted)
  stigmer run my-agent --secret-file .env.secret
  
  # Combine env files, secret files, and inline overrides
  stigmer run my-agent --env-file .env --secret-file .env.secret --env DEBUG=true
  
  # Run by ID
  stigmer run agt_01kewqjbtdy0w4d14bnhhy4yc2
  stigmer run wf_01abc123xyz456
  
  # Override organization
  stigmer run my-agent --org my-org-id`,
		Run: func(cmd *cobra.Command, args []string) {
			// Parse and merge environment variables and secrets from files and flags
			runtimeEnv, err := envfile.LoadAndMergeWithSecrets(
				envFileFlags,
				secretFileFlags,
				envFlags,
				secretFlags,
			)
			if err != nil {
				cliprint.PrintError("Failed to load environment: %s", err)
				return
			}

			hasReference := len(args) > 0

			if hasReference {
				// REFERENCE MODE: Run specific agent/workflow by name/ID
				reference := args[0]
				runReferenceMode(reference, message, orgOverride, runtimeEnv, follow)
			} else {
				// AUTO-DISCOVERY MODE: Discover from Stigmer.yaml and prompt for selection
				runAutoDiscoveryMode(message, orgOverride, runtimeEnv, follow)
			}
		},
	}

	// Message flag
	cmd.Flags().StringVar(&message, "message", "", "initial message/prompt for execution")

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
	cmd.Flags().BoolVar(&follow, "follow", true, "stream execution logs in real-time (default: true)")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides Stigmer.yaml and context)")

	return cmd
}
