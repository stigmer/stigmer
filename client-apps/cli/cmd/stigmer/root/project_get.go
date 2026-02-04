package root

import (
	"github.com/spf13/cobra"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
)

// newProjectGetCommand creates the project get subcommand.
func newProjectGetCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "get <name-or-id>",
		Short: "Get a project by name or ID",
		Long: `Get a project configuration by name (slug) or resource ID.

The command automatically detects whether the argument is a resource ID
or a name/slug and uses the appropriate lookup method.

Output formats:
  - table: Human-readable summary (default)
  - yaml:  Full resource as YAML
  - json:  Full resource as JSON`,
		Example: `  # Get by name (slug)
  stigmer project get my-project

  # Get by org/slug
  stigmer project get stigmer/ai-assistant

  # Get by resource ID
  stigmer project get prj_abc123

  # Output as YAML
  stigmer project get my-project --output yaml

  # Output as JSON
  stigmer project get my-project --output json

  # Get from specific organization
  stigmer project get my-project --org acme-corp

  # Use the 'proj' alias
  stigmer proj get my-project`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			result, err := executeProjectGet(projectGetOptions{
				Reference:    reference,
				OrgOverride:  orgOverride,
				OutputFormat: outputFormat,
			})
			clierr.Handle(err)

			project.DisplayGetResult(result, outputFormat)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

	return cmd
}

// projectGetOptions contains options for the get operation.
type projectGetOptions struct {
	Reference    string
	OrgOverride  string
	OutputFormat string
}

// executeProjectGet handles the project get operation.
func executeProjectGet(opts projectGetOptions) (*projectv1.Project, error) {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 2: Resolve organization
	orgID, err := resolveProjectOrganization(cfg, opts.OrgOverride)
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

	// Step 5: Get project from backend
	result, err := project.GetFromBackend(conn, orgID, opts.Reference)
	if err != nil {
		return nil, err
	}

	return result, nil
}
