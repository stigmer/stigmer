package root

import (
	"github.com/spf13/cobra"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// newAgentGetCommand creates the agent get subcommand.
func newAgentGetCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "get <name-or-id>",
		Short: "Get an agent by name or ID",
		Long: `Get an agent configuration by name (slug) or resource ID.

The command automatically detects whether the argument is a resource ID
or a name/slug and uses the appropriate lookup method.

Output formats:
  - table: Human-readable summary (default)
  - yaml:  Full resource as YAML
  - json:  Full resource as JSON`,
		Example: `  # Get by name (slug)
  stigmer agent get my-agent

  # Get by org/slug
  stigmer agent get stigmer/code-reviewer

  # Get by resource ID
  stigmer agent get agt_abc123

  # Output as YAML
  stigmer agent get my-agent --output yaml

  # Output as JSON
  stigmer agent get my-agent --output json

  # Get from specific organization
  stigmer agent get my-agent --org acme-corp`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			result, err := executeAgentGet(agentGetOptions{
				Reference:    reference,
				OrgOverride:  orgOverride,
				OutputFormat: outputFormat,
			})
			clierr.Handle(err)

			agent.DisplayGetResult(result, outputFormat)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

	return cmd
}

// agentGetOptions contains options for the get operation.
type agentGetOptions struct {
	Reference    string
	OrgOverride  string
	OutputFormat string
}

// executeAgentGet handles the agent get operation.
func executeAgentGet(opts agentGetOptions) (*agentv1.Agent, error) {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 2: Resolve organization
	orgID, err := resolveAgentOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return nil, err
	}

	// Step 3: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, err
		}
	}

	// Step 4: Connect to backend
	conn, err := backend.NewConnection()
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	// Step 5: Get agent from backend
	result, err := agent.GetFromBackend(conn, orgID, opts.Reference)
	if err != nil {
		return nil, err
	}

	return result, nil
}
