package root

import (
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apikey"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/organization"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"google.golang.org/grpc"
)

// NewListCommand creates the unified list command.
func NewListCommand() *cobra.Command {
	var outputFormat string
	var limit int32
	var verbFilter string

	cmd := &cobra.Command{
		Use:   "list <type>",
		Short: "List resources by type",
		Long: `List all resources of a given type.

The type can be specified using any alias:
  - types, type              (available resource types)
  - organizations, organization, org
  - agents, agent, agt
  - workflows, workflow, wf
  - mcpservers, mcpserver, mcp
  - projects, project, proj
  - skills, skill
  - executions, execution, exec
  - sessions, session, ses

Both singular and plural forms are accepted.`,
		Example: `  # List available resource types
  stigmer list types

  # List types that support the "run" verb
  stigmer list types --verb run

  # List all agents
  stigmer list agents

  # List with limit
  stigmer list agents --limit 10

  # Output as YAML or JSON
  stigmer list agents --output yaml`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeList(listOptions{
				TypeArg:      args[0],
				OrgOverride:  GetOrgFlag(cmd),
				OutputFormat: outputFormat,
				Limit:        limit,
				VerbFilter:   verbFilter,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().Int32Var(&limit, "limit", 50, "maximum number of results")
	cmd.Flags().StringVar(&verbFilter, "verb", "", "filter to types supporting this verb (only for 'list types')")

	return cmd
}

// listOptions contains options for the list command.
type listOptions struct {
	TypeArg      string
	OrgOverride  string
	OutputFormat string
	Limit        int32
	VerbFilter   string
}

// isTypesType checks if the type arg refers to the meta-listing of resource types.
func isTypesType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "type" || normalized == "types"
}

// isExecutionType checks if the type arg refers to executions.
// Executions are special - not in the registry since they use dedicated RPCs.
func isExecutionType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "execution" || normalized == "executions" || normalized == "exec"
}

// isSessionType checks if the type arg refers to sessions.
func isSessionType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "session" || normalized == "sessions" || normalized == "ses"
}

// isOrganizationType checks if the type arg refers to organizations.
func isOrganizationType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "organization" || normalized == "organizations" || normalized == "org" || normalized == "orgs"
}

// executeList lists resources of a given type.
func executeList(opts listOptions) error {
	// Special case: "types" lists available resource types from the local registry.
	if isTypesType(opts.TypeArg) {
		return executeListTypes(opts.VerbFilter, opts.OutputFormat)
	}

	// Special case: Executions don't go through the registry
	// They use their own AgentExecutionQueryController.list() RPC
	if isExecutionType(opts.TypeArg) {
		return executeListExecutions(opts)
	}

	// Special case: Sessions use their own SessionQueryController.list() RPC
	if isSessionType(opts.TypeArg) {
		return executeListSessions(opts)
	}

	// Special case: Organizations use FindMyOrganizations and don't need org context
	if isOrganizationType(opts.TypeArg) {
		return executeListOrganizations(opts)
	}

	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: types, organizations, agents, workflows, mcpservers, projects, skills, executions, sessions", opts.TypeArg)
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

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	conn := client.Conn().(*grpc.ClientConn)

	// Step 4: Route to appropriate handler
	return routeList(info, orgID, opts.OutputFormat, opts.Limit, conn)
}

// routeList routes to the appropriate list handler based on kind.
func routeList(info *types.TypeInfo, orgID, format string, limit int32, conn grpc.ClientConnInterface) error {
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

	case apiresourcekind.ApiResourceKind_api_key:
		return listApiKeys(format, conn)

	default:
		return fmt.Errorf("list not implemented for %s", info.DisplayName)
	}
}

// listAgents lists all agents.
func listAgents(orgID, format string, limit int32, conn grpc.ClientConnInterface) error {
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
func listWorkflows(orgID, format string, limit int32, conn grpc.ClientConnInterface) error {
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
func listMcpServers(orgID, format string, limit int32, conn grpc.ClientConnInterface) error {
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
		climsg.Warning("MCP server list not yet fully implemented")
		climsg.Info("Use 'stigmer get mcpserver <name>' to retrieve specific servers")
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
func listProjects(orgID, format string, limit int32, conn grpc.ClientConnInterface) error {
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
func listSkills(orgID, format string, limit int32, conn grpc.ClientConnInterface) error {
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

// executeListExecutions handles the special case of listing executions.
// Executions use their own dedicated RPC, not the SearchService.
func executeListExecutions(opts listOptions) error {
	// Setup backend connection
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
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

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	conn := client.Conn()

	// List executions using dedicated package
	result, err := execution.List(&execution.ListOptions{
		Conn:     conn,
		PageSize: opts.Limit,
		// Phase filter could be added via --status flag in future
	})
	if err != nil {
		return errors.Wrap(err, "failed to list executions")
	}

	// Display results
	execution.DisplayListResult(result, opts.OutputFormat)

	// Show helpful hint if empty
	if len(result.GetEntries()) == 0 {
		fmt.Println()
		climsg.Info("Tip: Run an agent to create an execution:")
		climsg.Info("  stigmer run agent <name>")
		fmt.Println()
	}

	return nil
}

// executeListSessions handles listing sessions.
// Sessions use their own dedicated RPC, not the SearchService.
func executeListSessions(opts listOptions) error {
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
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

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	conn := client.Conn()

	result, err := session.List(&session.ListOptions{
		Conn:     conn,
		PageSize: opts.Limit,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list sessions")
	}

	session.DisplayListResult(result, opts.OutputFormat)

	if len(result.GetEntries()) == 0 {
		fmt.Println()
		climsg.Info("Tip: Run an agent to create a session:")
		climsg.Info("  stigmer run agent <name>")
		fmt.Println()
	}

	return nil
}

// executeListOrganizations handles listing organizations.
// Organizations use their own dedicated FindMyOrganizations RPC
// and don't require an org context.
func executeListOrganizations(opts listOptions) error {
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
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

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	conn := client.Conn()

	orgs, err := organization.ListFromBackend(conn)
	if err != nil {
		return errors.Wrap(err, "failed to list organizations")
	}

	organization.DisplayListResult(orgs, opts.OutputFormat)
	return nil
}

// parsePhaseFilter parses a phase string to ExecutionPhase.
// Used for future --status flag support.
func parsePhaseFilter(status string) agentexecutionv1.ExecutionPhase {
	switch strings.ToLower(status) {
	case "pending":
		return agentexecutionv1.ExecutionPhase_EXECUTION_PENDING
	case "running", "in_progress", "in-progress":
		return agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS
	case "completed", "complete", "success":
		return agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED
	case "failed", "fail", "error":
		return agentexecutionv1.ExecutionPhase_EXECUTION_FAILED
	case "cancelled", "canceled":
		return agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
	case "terminated":
		return agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED
	case "paused":
		return agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED
	default:
		return agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED
	}
}

// listApiKeys lists all API keys for the authenticated user.
// API keys are not search-indexed, so this uses the dedicated FindAll RPC.
func listApiKeys(format string, conn grpc.ClientConnInterface) error {
	keys, err := apikey.ListFromBackend(conn)
	if err != nil {
		return errors.Wrap(err, "failed to list API keys")
	}

	apikey.DisplayListResult(keys, format)
	return nil
}
