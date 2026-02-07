package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"google.golang.org/grpc"
)

// NewGetCommand creates the unified get command.
func NewGetCommand() *cobra.Command {
	var outputFormat string
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "get <type> <name-or-id>",
		Short: "Get a resource by type and reference",
		Long: `Get a resource by type and name or ID.

The type can be specified using any alias:
  - agent, agt, agents
  - workflow, wf, workflows
  - mcpserver, mcp, mcp-server
  - project, proj, projects
  - skill, skills

The reference can be:
  - Resource ID (e.g., agt_abc123)
  - Slug (e.g., my-agent)
  - Org/slug (e.g., stigmer/my-agent)`,
		Example: `  # Get agent by slug
  stigmer get agent my-agent

  # Get workflow by ID
  stigmer get workflow wfl_abc123

  # Get with org/slug reference
  stigmer get agent stigmer/my-agent

  # Output as YAML or JSON
  stigmer get agent my-agent --output yaml
  stigmer get workflow my-wf --output json`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeGet(getOptions{
				TypeArg:      args[0],
				Reference:    args[1],
				OrgOverride:  orgOverride,
				OutputFormat: outputFormat,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID override")

	return cmd
}

// getOptions contains options for the get command.
type getOptions struct {
	TypeArg      string
	Reference    string
	OrgOverride  string
	OutputFormat string
}

// executeGet retrieves a resource by type and reference.
func executeGet(opts getOptions) error {
	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: agent, workflow, mcpserver, project, skill", opts.TypeArg)
	}

	// Step 2: Check verb support
	if !info.SupportsVerb(types.VerbGet) {
		return formatUnsupportedVerbError(info, types.VerbGet)
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
	return routeGet(info, opts.Reference, orgID, opts.OutputFormat, conn)
}

// routeGet routes to the appropriate get handler based on kind.
func routeGet(info *types.TypeInfo, ref, orgID, format string, conn *grpc.ClientConn) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return getAgent(ref, orgID, format, conn)

	case apiresourcekind.ApiResourceKind_workflow:
		return getWorkflow(ref, orgID, format, conn)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return getMcpServer(ref, orgID, format, conn)

	case apiresourcekind.ApiResourceKind_project:
		return getProject(ref, orgID, format, conn)

	case apiresourcekind.ApiResourceKind_skill:
		return getSkill(ref, orgID, format, conn)

	default:
		return fmt.Errorf("get not implemented for %s", info.DisplayName)
	}
}

// getAgent retrieves an agent.
func getAgent(ref, orgID, format string, conn *grpc.ClientConn) error {
	result, err := agent.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}
	agent.DisplayGetResult(result, format)
	return nil
}

// getWorkflow retrieves a workflow.
func getWorkflow(ref, orgID, format string, conn *grpc.ClientConn) error {
	result, err := workflow.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}
	workflow.DisplayGetResult(result, format)
	return nil
}

// getMcpServer retrieves an MCP server.
func getMcpServer(ref, orgID, format string, conn *grpc.ClientConn) error {
	result, err := mcpserver.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}
	mcpserver.DisplayGetResult(result, format)
	return nil
}

// getProject retrieves a project.
func getProject(ref, orgID, format string, conn *grpc.ClientConn) error {
	result, err := project.GetFromBackend(conn, orgID, ref)
	if err != nil {
		return err
	}
	project.DisplayGetResult(result, format)
	return nil
}

// getSkill retrieves a skill.
func getSkill(ref, orgID, format string, conn *grpc.ClientConn) error {
	// TODO: Implement skill get when skill handlers are available
	return fmt.Errorf("skill get not yet implemented")
}
