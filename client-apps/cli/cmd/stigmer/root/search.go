package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
)

// NewSearchCommand creates the unified search command.
func NewSearchCommand() *cobra.Command {
	var outputFormat string
	var excludePublic bool
	var page int32
	var pageSize int32

	cmd := &cobra.Command{
		Use:   "search <type> <query>",
		Short: "Search resources by text query",
		Long: `Search for resources matching a text query.

The type can be specified using any alias:
  - agents, agent, agt
  - workflows, workflow, wf

The search looks for matches in resource names, descriptions, and tags.
Results are sorted by relevance score (best matches first).

By default, searches all resources you have access to, including public
platform resources. Use --exclude-public to see only your own resources.

Output formats:
  - table: Human-readable table (default)
  - yaml:  Full results as YAML
  - json:  Full results as JSON`,
		Example: `  # Search for agents related to code review
  stigmer search agents "code review"

  # Search for workflows related to deployment
  stigmer search workflows "deploy"

  # Search within a specific organization
  stigmer search agents "kubernetes" --org acme-corp

  # Exclude public/platform resources
  stigmer search agents "api" --exclude-public

  # Output as JSON for scripting
  stigmer search workflows "data" --output json

  # Paginate results
  stigmer search agents "test" --page 2 --page-size 50`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeSearch(searchOptions{
				TypeArg:       args[0],
				Query:         args[1],
				OrgOverride:   GetOrgFlag(cmd),
				ExcludePublic: excludePublic,
				OutputFormat:  outputFormat,
				Page:          page,
				PageSize:      pageSize,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().BoolVar(&excludePublic, "exclude-public", false, "exclude public/platform resources")
	cmd.Flags().Int32Var(&page, "page", 1, "page number (1-indexed)")
	cmd.Flags().Int32Var(&pageSize, "page-size", 20, "results per page (max 100)")

	return cmd
}

// searchOptions contains options for the search command.
type searchOptions struct {
	TypeArg       string
	Query         string
	OrgOverride   string
	ExcludePublic bool
	OutputFormat  string
	Page          int32
	PageSize      int32
}

// executeSearch validates type and executes the search.
func executeSearch(opts searchOptions) error {
	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: agent, workflow", opts.TypeArg)
	}

	// Step 2: Check verb support
	if !info.SupportsVerb(types.VerbSearch) {
		return formatUnsupportedVerbError(info, types.VerbSearch)
	}

	// Step 3: Validate query
	if opts.Query == "" {
		return errors.New("search query is required")
	}

	// Step 4: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	// Step 5: Resolve organization if specified
	var orgID string
	if opts.OrgOverride != "" {
		orgID, err = resolveOrganization(cfg, opts.OrgOverride)
		if err != nil {
			return err
		}
	}

	// Step 6: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	// Step 7: Connect to backend
	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	conn := client.Conn()

	// Step 8: Execute search
	result, err := search.Search(&search.Options{
		Conn:          conn,
		Kinds:         []apiresourcekind.ApiResourceKind{info.ProtoKind},
		Query:         opts.Query,
		Org:           orgID,
		ExcludePublic: opts.ExcludePublic,
		Page:          opts.Page,
		PageSize:      opts.PageSize,
	})
	if err != nil {
		return errors.Wrap(err, "search request failed")
	}

	// Step 9: Display results
	displaySearchResult(result, opts.Query, info.DisplayName, opts.OutputFormat, opts.Page)

	return nil
}

// displaySearchResult displays search results with appropriate formatting.
func displaySearchResult(result *search.Result, query, resourceName, format string, page int32) {
	if result.IsEmpty() {
		search.DisplayEmptyResults(resourceName, query)
		return
	}

	search.DisplayResults(result, &search.DisplayOptions{
		Format:       format,
		ResourceName: resourceName,
	})

	search.DisplayPaginationInfo(page, result.TotalPages, result.TotalCount)
}
