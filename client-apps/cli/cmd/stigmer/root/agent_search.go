package root

import (
	"github.com/pkg/errors"
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
)

// newAgentSearchCommand creates the agent search subcommand.
func newAgentSearchCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string
	var excludePublic bool
	var page int32
	var pageSize int32

	cmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search agents by text",
		Long: `Search for agents matching a text query.

The search looks for matches in agent names, descriptions, and tags.
Results are sorted by relevance score (best matches first).

By default, searches all agents you have access to, including public
platform agents. Use --exclude-public to see only your own agents.
Use --org to search within a specific organization.

Output formats:
  - table: Human-readable table (default)
  - yaml:  Full results as YAML
  - json:  Full results as JSON`,
		Example: `  # Search for agents related to code review
  stigmer agent search "code review"

  # Search for security-related agents
  stigmer agent search "security"

  # Search within a specific organization
  stigmer agent search "kubernetes" --org acme-corp

  # Exclude public/platform agents
  stigmer agent search "api" --exclude-public

  # Output as JSON
  stigmer agent search "deploy" --output json

  # Paginate results
  stigmer agent search "test" --page 2 --page-size 50`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			query := args[0]

			result, err := executeAgentSearch(agentSearchOptions{
				Query:         query,
				OrgOverride:   orgOverride,
				ExcludePublic: excludePublic,
				OutputFormat:  outputFormat,
				Page:          page,
				PageSize:      pageSize,
			})
			clierr.Handle(err)

			agent.DisplaySearchResult(result, query, outputFormat, page)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "search within specific organization")
	cmd.Flags().BoolVar(&excludePublic, "exclude-public", false, "exclude public/platform agents")
	cmd.Flags().Int32Var(&page, "page", 1, "page number (1-indexed)")
	cmd.Flags().Int32Var(&pageSize, "page-size", 20, "results per page (max 100)")

	return cmd
}

// agentSearchOptions contains options for the search operation.
type agentSearchOptions struct {
	Query         string
	OrgOverride   string
	ExcludePublic bool
	OutputFormat  string
	Page          int32
	PageSize      int32
}

// executeAgentSearch handles the agent search operation.
func executeAgentSearch(opts agentSearchOptions) (*search.Result, error) {
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
		orgID, err = resolveAgentOrganization(cfg, opts.OrgOverride)
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

	// Step 5: Search for agents
	result, err := search.Search(&search.Options{
		Conn:          conn,
		Kinds:         []apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_agent},
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
