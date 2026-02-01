package root

import (
	"github.com/spf13/cobra"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

// newWorkflowGetCommand creates the workflow get subcommand.
func newWorkflowGetCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "get <name-or-id>",
		Short: "Get a workflow by name or ID",
		Long: `Get a workflow configuration by name (slug) or resource ID.

The command automatically detects whether the argument is a resource ID
or a name/slug and uses the appropriate lookup method.

Output formats:
  - table: Human-readable summary (default)
  - yaml:  Full resource as YAML
  - json:  Full resource as JSON`,
		Example: `  # Get by name (slug)
  stigmer workflow get my-workflow

  # Get by org/slug
  stigmer workflow get stigmer/deploy-pipeline

  # Get by resource ID
  stigmer workflow get wfl_abc123

  # Output as YAML
  stigmer workflow get my-workflow --output yaml

  # Output as JSON
  stigmer workflow get my-workflow --output json

  # Get from specific organization
  stigmer workflow get my-workflow --org acme-corp`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			result, err := executeWorkflowGet(workflowGetOptions{
				Reference:    reference,
				OrgOverride:  orgOverride,
				OutputFormat: outputFormat,
			})
			clierr.Handle(err)

			workflow.DisplayGetResult(result, outputFormat)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

	return cmd
}

// workflowGetOptions contains options for the get operation.
type workflowGetOptions struct {
	Reference    string
	OrgOverride  string
	OutputFormat string
}

// executeWorkflowGet handles the workflow get operation.
func executeWorkflowGet(opts workflowGetOptions) (*workflowv1.Workflow, error) {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 2: Resolve organization
	orgID, err := resolveWorkflowOrganization(cfg, opts.OrgOverride)
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

	// Step 5: Get workflow from backend
	result, err := workflow.GetFromBackend(conn, orgID, opts.Reference)
	if err != nil {
		return nil, err
	}

	return result, nil
}
