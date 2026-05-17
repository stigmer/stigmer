package root

import (
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apikey"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/execution"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/organization"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/skill"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

// NewGetCommand creates the unified get command.
func NewGetCommand() *cobra.Command {
	var outputFormat string

	cmd := &cobra.Command{
		Use:   "get <type> <slug-or-id>",
		Short: "Get a resource by type and reference",
		Long: `Get a resource by type and slug or ID.

The type can be specified using any alias:
  - organization, org, organizations
  - agent, agt, agents
  - workflow, wf, workflows
  - mcpserver, mcp, mcp-server
  - project, proj, projects
  - skill, skills
  - execution, exec (by execution ID only)

The reference can be:
  - Resource ID (e.g., agt_abc123, aex_xyz789)
  - Slug (e.g., my-agent) - not for executions
  - Org/slug (e.g., stigmer/my-agent) - not for executions`,
		Example: `  # Get organization by slug
  stigmer get organization default

  # Get agent by slug
  stigmer get agent my-agent

  # Get workflow by ID
  stigmer get workflow wfl_abc123

  # Get execution by ID (shows artifacts)
  stigmer get execution aex_01abc123

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
				OrgOverride:  GetOrgFlag(cmd),
				OutputFormat: outputFormat,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")

	return cmd
}

// getOptions contains options for the get command.
type getOptions struct {
	TypeArg      string
	Reference    string
	OrgOverride  string
	OutputFormat string
}

// isGetExecutionType checks if the type arg refers to executions.
func isGetExecutionType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "execution" || normalized == "executions" || normalized == "exec"
}

// isGetOrganizationType checks if the type arg refers to organizations.
func isGetOrganizationType(typeArg string) bool {
	normalized := strings.ToLower(strings.TrimSpace(typeArg))
	return normalized == "organization" || normalized == "organizations" || normalized == "org" || normalized == "orgs"
}

// executeGet retrieves a resource by type and reference.
func executeGet(opts getOptions) error {
	// Special case: Executions don't go through the registry
	// They use their own AgentExecutionQueryController.get() RPC
	if isGetExecutionType(opts.TypeArg) {
		return executeGetExecution(opts)
	}

	// Special case: Organizations use FindMyOrganizations and don't need org context
	if isGetOrganizationType(opts.TypeArg) {
		return executeGetOrganization(opts)
	}

	// Step 1: Resolve type from alias
	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: organization, agent, workflow, mcpserver, project, skill, execution", opts.TypeArg)
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

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()

	// Step 4: Route to appropriate handler
	return routeGet(info, opts.Reference, orgID, opts.OutputFormat, client)
}

// routeGet routes to the appropriate get handler based on kind.
func routeGet(info *types.TypeInfo, ref, orgID, format string, client *stigmer.Client) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return getAgent(ref, orgID, format, client)

	case apiresourcekind.ApiResourceKind_workflow:
		return getWorkflow(ref, orgID, format, client)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return getMcpServer(ref, orgID, format, client)

	case apiresourcekind.ApiResourceKind_project:
		return getProject(ref, orgID, format, client)

	case apiresourcekind.ApiResourceKind_skill:
		return getSkill(ref, orgID, format, client)

	case apiresourcekind.ApiResourceKind_api_key:
		return getApiKey(ref, format, client)

	default:
		return fmt.Errorf("get not implemented for %s", info.DisplayName)
	}
}

// getAgent retrieves an agent.
func getAgent(ref, orgID, format string, client *stigmer.Client) error {
	result, err := agent.GetFromBackend(client, orgID, ref)
	if err != nil {
		return err
	}
	agent.DisplayGetResult(result, format)
	return nil
}

// getWorkflow retrieves a workflow.
func getWorkflow(ref, orgID, format string, client *stigmer.Client) error {
	result, err := workflow.GetFromBackend(client, orgID, ref)
	if err != nil {
		return err
	}
	workflow.DisplayGetResult(result, format)
	return nil
}

// getMcpServer retrieves an MCP server.
func getMcpServer(ref, orgID, format string, client *stigmer.Client) error {
	result, err := mcpserver.GetFromBackend(client, orgID, ref)
	if err != nil {
		return err
	}
	mcpserver.DisplayGetResult(result, format)
	return nil
}

// getProject retrieves a project.
func getProject(ref, orgID, format string, client *stigmer.Client) error {
	result, err := project.GetFromBackend(client, orgID, ref)
	if err != nil {
		return err
	}
	project.DisplayGetResult(result, format)
	return nil
}

// getSkill retrieves a skill.
func getSkill(ref, orgID, format string, client *stigmer.Client) error {
	result, err := skill.GetFromBackend(client, orgID, ref)
	if err != nil {
		return err
	}
	skill.DisplayGetResult(result, format)
	return nil
}

// executeGetExecution handles the special case of getting an execution.
// Executions use their own dedicated RPCs and are always referenced by ID.
// Supports both agent executions (aex_) and workflow executions (wex_).
func executeGetExecution(opts getOptions) error {
	execType, err := execution.ResolveType(opts.Reference)
	if err != nil {
		return err
	}

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

	switch execType {
	case execution.ExecutionTypeAgent:
		result, err := execution.GetFromBackend(client, opts.Reference)
		if err != nil {
			return errors.Wrap(err, "failed to get agent execution")
		}
		execution.DisplayGetResult(result, opts.OutputFormat)

	case execution.ExecutionTypeWorkflow:
		result, err := execution.GetWorkflowExecution(client, opts.Reference)
		if err != nil {
			return errors.Wrap(err, "failed to get workflow execution")
		}
		execution.DisplayWorkflowExecutionGetResult(result, opts.OutputFormat)
	}

	return nil
}

// executeGetOrganization handles the special case of getting an organization.
// Organizations use FindMyOrganizations and don't require org context.
func executeGetOrganization(opts getOptions) error {
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

	result, err := organization.GetFromBackend(client, opts.Reference)
	if err != nil {
		return err
	}

	organization.DisplayGetResult(result, opts.OutputFormat)
	return nil
}

// getApiKey retrieves an API key by ID.
func getApiKey(ref, format string, client *stigmer.Client) error {
	result, err := apikey.GetFromBackend(client, ref)
	if err != nil {
		return err
	}
	apikey.DisplayGetResult(result, format)
	return nil
}
