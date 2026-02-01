package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// NewAgentCommand creates the agent management command group.
func NewAgentCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "agent",
		Aliases: []string{"agt"},
		Short:   "Manage AI agents",
		Long: `Manage AI agent configurations.

Agents are YAML-based configurations that define AI assistants with specific
capabilities, tools, and behaviors. Unlike workflows (which require SDK code),
agents are purely declarative and follow the Kubernetes-style apply pattern.

Agents can:
  - Use MCP servers for tools and capabilities
  - Reference skills for specialized behaviors
  - Delegate to sub-agents for complex tasks
  - Be executed via 'stigmer agent run'`,
		Example: `  # Apply an agent from a YAML file
  stigmer agent apply agent.yaml

  # Apply from current directory (auto-detect agent.yaml)
  stigmer agent apply

  # Validate without applying
  stigmer agent apply --dry-run

  # Get an agent by name
  stigmer agent get my-agent

  # List all agents
  stigmer agent list

  # Search for agents
  stigmer agent search "code review"

  # Delete an agent
  stigmer agent delete my-agent

  # Run an agent
  stigmer agent run my-agent

  # Run with an initial message
  stigmer agent run my-agent --message "Analyze the code"

  # Run with environment variables
  stigmer agent run my-agent --env API_KEY=xxx`,
	}

	cmd.AddCommand(newAgentApplyCommand())
	cmd.AddCommand(newAgentValidateCommand())
	cmd.AddCommand(newAgentGetCommand())
	cmd.AddCommand(newAgentListCommand())
	cmd.AddCommand(newAgentSearchCommand())
	cmd.AddCommand(newAgentDeleteCommand())
	cmd.AddCommand(newAgentRunCommand())

	return cmd
}

// newAgentApplyCommand creates the agent apply subcommand.
func newAgentApplyCommand() *cobra.Command {
	var orgOverride string
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "apply [file]",
		Short: "Apply an agent configuration",
		Long: `Apply an agent configuration from a YAML or JSON file.

This command creates a new agent or updates an existing one based on
the configuration file. It follows Kubernetes-style declarative semantics:
the system reconciles to the desired state specified in the file.

If no file is specified, the command looks for 'agent.yaml' or 
'AGENT.yaml' in the current directory.

The configuration file must include:
  - apiVersion: agentic.stigmer.ai/v1
  - kind: Agent
  - metadata.name: Human-readable name
  - spec.instructions: Agent instructions (min 10 chars)`,
		Example: `  # Apply from a specific file
  stigmer agent apply agent.yaml

  # Apply from current directory (auto-detect agent.yaml)
  stigmer agent apply

  # Apply to a specific organization
  stigmer agent apply --org my-org

  # Dry run (validate without applying)
  stigmer agent apply --dry-run

  # Example agent.yaml:
  apiVersion: agentic.stigmer.ai/v1
  kind: Agent
  metadata:
    name: Code Review Agent
  spec:
    description: "Reviews code for best practices"
    instructions: |
      You are a code review assistant. Review code for:
      - Code quality and best practices
      - Security vulnerabilities
      - Performance issues
    mcp_server_usages:
      - mcp_server_ref:
          kind: mcp_server
          slug: github`,
		Args: cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			var filePath string
			if len(args) > 0 {
				filePath = args[0]
			}

			result, err := executeAgentApply(agentApplyOptions{
				FilePath:    filePath,
				OrgOverride: orgOverride,
				DryRun:      dryRun,
			})
			clierr.Handle(err)

			if !dryRun && result != nil {
				agent.DisplayApplyResult(result)
			}
		},
	}

	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "validate without applying")

	return cmd
}

// agentApplyOptions contains options for the apply operation.
type agentApplyOptions struct {
	FilePath    string
	OrgOverride string
	DryRun      bool
}

// executeAgentApply handles the agent apply operation.
func executeAgentApply(opts agentApplyOptions) (*agent.ApplyResult, error) {
	// Step 1: Load configuration file
	cliprint.PrintInfo("Loading agent configuration...")

	loadResult, err := agent.Load(&agent.LoadOptions{
		FilePath: opts.FilePath,
	})
	if err != nil {
		return nil, err
	}

	cliprint.PrintSuccess("Loaded configuration from: %s", loadResult.SourcePath)
	cliprint.PrintInfo("  Name: %s", loadResult.Agent.Metadata.Name)
	fmt.Println()

	// Step 2: Validate cross-field logic
	if err := agent.Validate(loadResult.Agent); err != nil {
		return nil, err
	}

	// Step 3: Dry run mode - just validate and preview
	if opts.DryRun {
		cliprint.PrintInfo("Dry run mode - configuration is valid")
		agent.DisplayAgentPreview(loadResult.Agent)
		cliprint.PrintSuccess("Dry run successful - no changes made")
		return nil, nil
	}

	// Step 4: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 5: Resolve organization
	orgID, err := resolveAgentOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return nil, err
	}

	// Step 6: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 7: Connect to backend
	cliprint.PrintInfo("Connecting to backend...")

	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	cliprint.PrintSuccess("Connected to backend")
	fmt.Println()

	// Step 8: Apply the configuration
	result, err := agent.Apply(&agent.ApplyOptions{
		Agent:  loadResult.Agent,
		OrgID:  orgID,
		Conn:   conn,
		Quiet:  false,
		DryRun: false,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}

// resolveAgentOrganization determines the organization ID based on backend type and overrides.
func resolveAgentOrganization(cfg *config.Config, orgOverride string) (string, error) {
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		orgID := "local"
		cliprint.PrintInfo("Using local backend (organization: %s)", orgID)
		return orgID, nil

	case config.BackendTypeCloud:
		if orgOverride != "" {
			cliprint.PrintInfo("Using organization from flag: %s", orgOverride)
			return orgOverride, nil
		}

		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			cliprint.PrintInfo("Using organization from context: %s", cfg.Backend.Cloud.OrgID)
			return cfg.Backend.Cloud.OrgID, nil
		}

		return "", fmt.Errorf("organization not set for cloud mode\n\nUse --org flag or run: stigmer context set --org <org-id>")

	default:
		return "", fmt.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}
}
