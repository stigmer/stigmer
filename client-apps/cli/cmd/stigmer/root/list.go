package root

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apikey"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/organization"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/runner"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// NewListCommand creates the unified list command.
func NewListCommand() *cobra.Command {
	var outputFormat string
	var limit int32
	var verbFilter string
	var typeFilter string

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
  - runners, runner, rnr     (local active runners)

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
  stigmer list agents --output yaml

  # List active runners on this machine
  stigmer list runners

  # List executions filtered by type
  stigmer list executions --type workflow
  stigmer list executions --type agent`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeList(listOptions{
				TypeArg:      args[0],
				OrgOverride:  GetOrgFlag(cmd),
				OutputFormat: outputFormat,
				Limit:        limit,
				VerbFilter:   verbFilter,
				TypeFilter:   typeFilter,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().Int32Var(&limit, "limit", 50, "maximum number of results")
	cmd.Flags().StringVar(&verbFilter, "verb", "", "filter to types supporting this verb (only for 'list types')")
	cmd.Flags().StringVar(&typeFilter, "type", "", "filter executions by type: agent, workflow (only for 'list executions')")

	return cmd
}

// listOptions contains options for the list command.
type listOptions struct {
	TypeArg      string
	OrgOverride  string
	OutputFormat string
	Limit        int32
	VerbFilter   string
	TypeFilter   string
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

// isRunnerType checks if the type arg refers to runners.
// Runners are listed from local state files, not the backend.
func isRunnerType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "runner" || normalized == "runners" || normalized == "rnr"
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

	// Special case: Runners are listed from local state files, no backend needed
	if isRunnerType(opts.TypeArg) {
		return executeListRunners()
	}

	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: types, organizations, agents, workflows, mcpservers, projects, skills, executions, sessions, runners", opts.TypeArg)
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

	// Step 4: Route to appropriate handler
	return routeList(info, orgID, opts.OutputFormat, opts.Limit, client)
}

// routeList routes to the appropriate list handler based on kind.
func routeList(info *types.TypeInfo, orgID, format string, limit int32, client *stigmer.Client) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return listAgents(orgID, format, limit, client)

	case apiresourcekind.ApiResourceKind_workflow:
		return listWorkflows(orgID, format, limit, client)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return listMcpServers(orgID, format, limit, client)

	case apiresourcekind.ApiResourceKind_project:
		return listProjects(orgID, format, limit, client)

	case apiresourcekind.ApiResourceKind_skill:
		return listSkills(orgID, format, limit, client)

	case apiresourcekind.ApiResourceKind_api_key:
		return listApiKeys(format, client)

	default:
		return fmt.Errorf("list not implemented for %s", info.DisplayName)
	}
}

// listAgents lists all agents.
func listAgents(orgID, format string, limit int32, client *stigmer.Client) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_agent,
		Org:      orgID,
		Client:   client,
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
func listWorkflows(orgID, format string, limit int32, client *stigmer.Client) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_workflow,
		Org:      orgID,
		Client:   client,
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
func listMcpServers(orgID, format string, limit int32, client *stigmer.Client) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_mcp_server,
		Org:      orgID,
		Client:   client,
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
func listProjects(orgID, format string, limit int32, client *stigmer.Client) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_project,
		Org:      orgID,
		Client:   client,
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
func listSkills(orgID, format string, limit int32, client *stigmer.Client) error {
	result, err := search.List(&search.ListOptions{
		Kind:     apiresourcekind.ApiResourceKind_skill,
		Org:      orgID,
		Client:   client,
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
// Supports both agent and workflow executions via --type filter.
func executeListExecutions(opts listOptions) error {
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

	typeFilter := strings.ToLower(strings.TrimSpace(opts.TypeFilter))

	switch typeFilter {
	case "workflow", "wf":
		return listWorkflowExecutions(client, opts)
	case "agent", "":
		return listAgentExecutions(client, opts)
	default:
		return fmt.Errorf("unknown execution type filter: %s\n\nValid values: agent, workflow", opts.TypeFilter)
	}
}

func listAgentExecutions(client *stigmer.Client, opts listOptions) error {
	result, err := execution.List(&execution.ListOptions{
		Client:   client,
		PageSize: opts.Limit,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list agent executions")
	}

	execution.DisplayListResult(result, opts.OutputFormat)

	if len(result.GetEntries()) == 0 {
		fmt.Println()
		climsg.Info("Tip: Run an agent to create an execution:")
		climsg.Info("  stigmer run agent <name>")
		fmt.Println()
	}

	return nil
}

func listWorkflowExecutions(client *stigmer.Client, opts listOptions) error {
	result, err := execution.ListWorkflow(&execution.ListWorkflowOptions{
		Client:   client,
		PageSize: opts.Limit,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list workflow executions")
	}

	execution.DisplayWorkflowExecutionListResult(result, opts.OutputFormat)

	if len(result.GetEntries()) == 0 {
		fmt.Println()
		climsg.Info("Tip: Run a workflow to create an execution:")
		climsg.Info("  stigmer run workflow <name>")
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

	result, err := session.List(&session.ListOptions{
		Client:   client,
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

	orgs, err := organization.ListFromBackend(client)
	if err != nil {
		return errors.Wrap(err, "failed to list organizations")
	}

	organization.DisplayListResult(orgs, opts.OutputFormat)
	return nil
}

// executeListRunners lists active runners from local state files.
// This is entirely local — no backend connection needed.
func executeListRunners() error {
	states, err := runner.ListAllRunnerStates()
	if err != nil {
		return errors.Wrap(err, "failed to list runners")
	}

	if len(states) == 0 {
		display.DisplayEmptyResults("runners", "")
		fmt.Println()
		climsg.Info("Start a runner:")
		climsg.Info("  stigmer up")
		fmt.Println()
		return nil
	}

	names := make([]string, 0, len(states))
	for name := range states {
		names = append(names, name)
	}
	sort.Strings(names)

	tbl := display.NewTable(
		[]string{"NAME", "PID", "BACKEND", "TASK QUEUE", "STARTED"},
		display.WithAdaptive(),
	)
	for _, name := range names {
		s := states[name]
		tbl.AddRow(name, strconv.Itoa(s.PID), s.BackendEndpoint, s.TaskQueue, formatRunnerAge(s.StartedAt))
	}

	fmt.Println()
	tbl.Render(os.Stdout)
	fmt.Println()
	return nil
}

func formatRunnerAge(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		m := int(d.Minutes())
		if m == 1 {
			return "1m ago"
		}
		return fmt.Sprintf("%dm ago", m)
	case d < 24*time.Hour:
		h := int(d.Hours())
		if h == 1 {
			return "1h ago"
		}
		return fmt.Sprintf("%dh ago", h)
	default:
		days := int(d.Hours() / 24)
		if days == 1 {
			return "1d ago"
		}
		return fmt.Sprintf("%dd ago", days)
	}
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
func listApiKeys(format string, client *stigmer.Client) error {
	keys, err := apikey.ListFromBackend(client)
	if err != nil {
		return errors.Wrap(err, "failed to list API keys")
	}

	apikey.DisplayListResult(keys, format)
	return nil
}
