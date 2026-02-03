package root

import (
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

// newWorkflowListCommand creates the workflow list subcommand.
func newWorkflowListCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string
	var allOrgs bool
	var page int32
	var pageSize int32

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List workflows",
		Long: `List workflows accessible to you.

By default, lists workflows in your current organization context.
Use --all-orgs to list workflows from all organizations you have access to.
Use --org to list workflows from a specific organization.

Output formats:
  - table: Human-readable table (default)
  - yaml:  Full results as YAML
  - json:  Full results as JSON`,
		Example: `  # List workflows in current organization
  stigmer workflow list

  # List workflows from a specific organization
  stigmer workflow list --org acme-corp

  # List workflows from all accessible organizations
  stigmer workflow list --all-orgs

  # Output as YAML
  stigmer workflow list --output yaml

  # Output as JSON (useful for scripting)
  stigmer workflow list --output json

  # Paginate results
  stigmer workflow list --page 2 --page-size 50

  # Use the 'wf' alias for brevity
  stigmer wf list`,
		Run: func(cmd *cobra.Command, args []string) {
			result, err := executeWorkflowList(workflowListOptions{
				OrgOverride:  orgOverride,
				AllOrgs:      allOrgs,
				OutputFormat: outputFormat,
				Page:         page,
				PageSize:     pageSize,
			})
			clierr.Handle(err)

			workflow.DisplayListResult(result, outputFormat, page)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization to list from")
	cmd.Flags().BoolVar(&allOrgs, "all-orgs", false, "list from all accessible organizations")
	cmd.Flags().Int32Var(&page, "page", 1, "page number (1-indexed)")
	cmd.Flags().Int32Var(&pageSize, "page-size", 20, "results per page (max 100)")

	return cmd
}

// workflowListOptions contains options for the list operation.
type workflowListOptions struct {
	OrgOverride  string
	AllOrgs      bool
	OutputFormat string
	Page         int32
	PageSize     int32
}

// executeWorkflowList handles the workflow list operation.
func executeWorkflowList(opts workflowListOptions) (*search.Result, error) {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 2: Resolve organization (unless --all-orgs)
	var orgID string
	if !opts.AllOrgs {
		orgID, err = resolveWorkflowOrganization(cfg, opts.OrgOverride)
		if err != nil {
			return nil, err
		}
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

	// Step 5: Search for workflows (list mode: no query)
	result, err := search.Search(&search.Options{
		Conn:     conn,
		Kinds:    []apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_workflow},
		Query:    "", // Empty query = list mode
		Org:      orgID,
		Page:     opts.Page,
		PageSize: opts.PageSize,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}
