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
	var versionFlag string
	var versionHistory bool

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
  - Org/slug (e.g., stigmer/my-agent) - not for executions

For versioned resources (workflows, skills), use --version to fetch a
specific historical version or --version-history to show the version
timeline.`,
		Example: `  # Get workflow by slug
  stigmer get workflow my-wf

  # Get a specific historical version of a workflow
  stigmer get workflow my-org/my-wf --version abc123def456
  stigmer get workflow my-org/my-wf --version stable

  # Show version history for a workflow
  stigmer get workflow my-org/my-wf --version-history

  # Output as YAML or JSON
  stigmer get agent my-agent --output yaml
  stigmer get workflow my-wf --output json`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeGet(getOptions{
				TypeArg:        args[0],
				Reference:      args[1],
				OrgOverride:    GetOrgFlag(cmd),
				OutputFormat:   outputFormat,
				Version:        versionFlag,
				VersionHistory: versionHistory,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, yaml, json")
	cmd.Flags().StringVar(&versionFlag, "version", "", "get a specific version by hash or tag (versioned resources only)")
	cmd.Flags().BoolVar(&versionHistory, "version-history", false, "show version history timeline (versioned resources only)")

	return cmd
}

// getOptions contains options for the get command.
type getOptions struct {
	TypeArg        string
	Reference      string
	OrgOverride    string
	OutputFormat   string
	Version        string
	VersionHistory bool
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
	return routeGet(info, opts, orgID, client)
}

// routeGet routes to the appropriate get handler based on kind.
func routeGet(info *types.TypeInfo, opts getOptions, orgID string, client *stigmer.Client) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return getAgent(opts.Reference, orgID, opts.OutputFormat, client)

	case apiresourcekind.ApiResourceKind_workflow:
		return getWorkflow(opts, orgID, client)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return getMcpServer(opts.Reference, orgID, opts.OutputFormat, client)

	case apiresourcekind.ApiResourceKind_project:
		return getProject(opts.Reference, orgID, opts.OutputFormat, client)

	case apiresourcekind.ApiResourceKind_skill:
		return getSkill(opts.Reference, orgID, opts.OutputFormat, client)

	case apiresourcekind.ApiResourceKind_api_key:
		return getApiKey(opts.Reference, opts.OutputFormat, client)

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

// getWorkflow retrieves a workflow, with optional version resolution.
func getWorkflow(opts getOptions, orgID string, client *stigmer.Client) error {
	ref := opts.Reference

	// Parse org/slug from the reference for version operations.
	org, slug := parseOrgSlug(ref, orgID)

	if opts.VersionHistory {
		return workflow.RunVersionsList(client, org, slug, 50)
	}

	if opts.Version != "" {
		return workflow.RunVersionsGet(client, org, slug, opts.Version)
	}

	result, err := workflow.GetFromBackend(client, orgID, ref)
	if err != nil {
		return err
	}
	workflow.DisplayGetResult(result, opts.OutputFormat)
	return nil
}

// parseOrgSlug splits a reference into org and slug components.
// If the reference contains a slash, it's treated as "org/slug".
// Otherwise, the slug is the reference and org comes from the flag/config.
func parseOrgSlug(ref, orgID string) (string, string) {
	if idx := strings.Index(ref, "/"); idx > 0 {
		return ref[:idx], ref[idx+1:]
	}
	return orgID, ref
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
