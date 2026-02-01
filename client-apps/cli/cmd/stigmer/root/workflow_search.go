package root

import (
	"github.com/pkg/errors"
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

// newWorkflowSearchCommand creates the workflow search subcommand.
func newWorkflowSearchCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string
	var excludePublic bool
	var page int32
	var pageSize int32

	cmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search workflows by text",
		Long: `Search for workflows matching a text query.

The search looks for matches in workflow names, descriptions, and tags.
Results are sorted by relevance score (best matches first).

By default, searches all workflows you have access to, including public
platform workflows. Use --exclude-public to see only your own workflows.
Use --org to search within a specific organization.

Output formats:
  - table: Human-readable table (default)
  - yaml:  Full results as YAML
  - json:  Full results as JSON`,
		Example: `  # Search for workflows related to deployment
  stigmer workflow search "deploy"

  # Search for CI/CD workflows
  stigmer workflow search "ci cd"

  # Search within a specific organization
  stigmer workflow search "kubernetes" --org acme-corp

  # Exclude public/platform workflows
  stigmer workflow search "api" --exclude-public

  # Output as JSON for scripting
  stigmer workflow search "data" --output json

  # Paginate results
  stigmer workflow search "test" --page 2 --page-size 50

  # Use the 'wf' alias for brevity
  stigmer wf search "deploy"`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			query := args[0]

			result, err := executeWorkflowSearch(workflowSearchOptions{
				Query:         query,
				OrgOverride:   orgOverride,
				ExcludePublic: excludePublic,
				OutputFormat:  outputFormat,
				Page:          page,
				PageSize:      pageSize,
			})
			clierr.Handle(err)

			workflow.DisplaySearchResult(result, query, outputFormat, page)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "search within specific organization")
	cmd.Flags().BoolVar(&excludePublic, "exclude-public", false, "exclude public/platform workflows")
	cmd.Flags().Int32Var(&page, "page", 1, "page number (1-indexed)")
	cmd.Flags().Int32Var(&pageSize, "page-size", 20, "results per page (max 100)")

	return cmd
}

// workflowSearchOptions contains options for the search operation.
type workflowSearchOptions struct {
	Query         string
	OrgOverride   string
	ExcludePublic bool
	OutputFormat  string
	Page          int32
	PageSize      int32
}

// executeWorkflowSearch handles the workflow search operation.
func executeWorkflowSearch(opts workflowSearchOptions) (*search.Result, error) {
	// Validate query
	if opts.Query == "" {
		return nil, errors.New("search query is required")
	}

	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	// Step 2: Resolve organization if specified
	var orgID string
	if opts.OrgOverride != "" {
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

	// Step 5: Search for workflows
	result, err := search.Search(&search.Options{
		Conn:          conn,
		Kinds:         []apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_workflow},
		Query:         opts.Query,
		Org:           orgID,
		ExcludePublic: opts.ExcludePublic,
		Page:          opts.Page,
		PageSize:      opts.PageSize,
	})
	if err != nil {
		return nil, err
	}

	return result, nil
}
