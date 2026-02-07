package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"google.golang.org/grpc"
)

// NewListCommand creates the unified list command.
func NewListCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string
	var limit int32

	cmd := &cobra.Command{
		Use:   "list <type>",
		Short: "List resources by type",
		Long: `List all resources of a given type.

The type can be specified using any alias:
  - agents, agent, agt
  - workflows, workflow, wf
  - mcpservers, mcpserver, mcp
  - projects, project, proj
  - skills, skill

Both singular and plural forms are accepted.`,
		Example: `  # List all agents
  stigmer list agents

  # List workflows (singular works too)
  stigmer list workflow

  # List with limit
  stigmer list agents --limit 10

  # Output as YAML or JSON
  stigmer list agents --output yaml`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeList(listOptions{
				TypeArg:      args[0],
				OrgOverride:  orgOverride,
				OutputFormat: outputFormat,
				Limit:        limit,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID override")
	cmd.Flags().Int32Var(&limit, "limit", 50, "maximum number of results")

	return cmd
}

// listOptions contains options for the list command.
type listOptions struct {
	TypeArg      string
	OrgOverride  string
	OutputFormat string
	Limit        int32
}

// executeList lists resources of a given type.
func executeList(opts listOptions) error {
	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: agents, workflows, mcpservers, projects, skills", opts.TypeArg)
	}

	// Step 2: Check verb support
	if !info.SupportsVerb(types.VerbList) {
		return formatUnsupportedVerbError(info, types.VerbList)
	}

	// Step 3: Setup backend connection
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return err
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	conn, err := backend.NewConnection()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer conn.Close()

	// Step 4: Route to appropriate handler
	return routeList(info, orgID, opts.OutputFormat, opts.Limit, conn)
}

// routeList routes to the appropriate list handler based on kind.
func routeList(info *types.TypeInfo, orgID, format string, limit int32, conn *grpc.ClientConn) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return listAgents(orgID, format, limit, conn)

	case apiresourcekind.ApiResourceKind_workflow:
		return listWorkflows(orgID, format, limit, conn)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return listMcpServers(orgID, format, limit, conn)

	case apiresourcekind.ApiResourceKind_project:
		return listProjects(orgID, format, limit, conn)

	case apiresourcekind.ApiResourceKind_skill:
		return listSkills(orgID, format, limit, conn)

	default:
		return fmt.Errorf("list not implemented for %s", info.DisplayName)
	}
}

// listAgents lists all agents.
func listAgents(orgID, format string, limit int32, conn *grpc.ClientConn) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_agent,
		Org:      orgID,
		Conn:     conn,
		PageSize: limit,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list agents")
	}

	search.DisplayResults(result, &search.DisplayOptions{
		Format:       format,
		ResourceName: "Agent",
	})
	return nil
}

// listWorkflows lists all workflows.
func listWorkflows(orgID, format string, limit int32, conn *grpc.ClientConn) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_workflow,
		Org:      orgID,
		Conn:     conn,
		PageSize: limit,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list workflows")
	}

	search.DisplayResults(result, &search.DisplayOptions{
		Format:       format,
		ResourceName: "Workflow",
	})
	return nil
}

// listMcpServers lists all MCP servers.
func listMcpServers(orgID, format string, limit int32, conn *grpc.ClientConn) error {
	// MCP servers use the same search infrastructure
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_mcp_server,
		Org:      orgID,
		Conn:     conn,
		PageSize: limit,
	})
	if err != nil {
		// Fall back to not implemented if search doesn't support mcp_server
		fmt.Println()
		cliprint.PrintWarning("MCP server list not yet fully implemented")
		cliprint.PrintInfo("Use 'stigmer get mcpserver <name>' to retrieve specific servers")
		fmt.Println()
		return nil
	}

	search.DisplayResults(result, &search.DisplayOptions{
		Format:       format,
		ResourceName: "MCP Server",
	})
	return nil
}

// listProjects lists all projects.
func listProjects(orgID, format string, limit int32, conn *grpc.ClientConn) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_project,
		Org:      orgID,
		Conn:     conn,
		PageSize: limit,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list projects")
	}

	search.DisplayResults(result, &search.DisplayOptions{
		Format:       format,
		ResourceName: "Project",
	})
	return nil
}

// listSkills lists all skills.
func listSkills(orgID, format string, limit int32, conn *grpc.ClientConn) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_skill,
		Org:      orgID,
		Conn:     conn,
		PageSize: limit,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list skills")
	}

	search.DisplayResults(result, &search.DisplayOptions{
		Format:       format,
		ResourceName: "Skill",
	})
	return nil
}
