package root

import (
	"fmt"
	"os"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/organization"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewDeleteCommand creates the unified delete command.
func NewDeleteCommand() *cobra.Command {
	var force bool
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "delete <type> <slug-or-id>",
		Short: "Delete a resource by type and reference",
		Long: `Delete a resource by type and slug or ID.

The type can be specified using any alias:
  - agent, agt, agents
  - workflow, wf, workflows
  - mcpserver, mcp, mcp-server
  - project, proj, projects
  - skill, skills
  - execution, exec (cancels running execution)

The reference can be:
  - Resource ID (e.g., agt_abc123, aex_xyz789)
  - Slug (e.g., my-agent) - not for executions
  - Org/slug (e.g., stigmer/my-agent) - not for executions

WARNING: This operation is permanent and cannot be undone.
For executions, this gracefully cancels the running agent.`,
		Example: `  # Delete agent by slug
  stigmer delete agent my-agent

  # Delete workflow by ID
  stigmer delete workflow wfl_abc123

  # Cancel a running execution
  stigmer delete execution aex_01abc123

  # Force delete (skip confirmation)
  stigmer delete agent my-agent --force`,
		Args: cobra.ExactArgs(2),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeDelete(deleteOptions{
				TypeArg:      args[0],
				Reference:    args[1],
				OrgOverride:  GetOrgFlag(cmd),
				Force:        force,
				OutputFormat: resolveResultFormat(jsonOutput, quietOutput),
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "skip confirmation prompt")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

type deleteOptions struct {
	TypeArg      string
	Reference    string
	OrgOverride  string
	Force        bool
	OutputFormat clioutput.OutputFormat
}

// deleteContext bundles the resolved dependencies that every resource delete
// handler needs. Created once in executeDelete and threaded through routeDelete.
type deleteContext struct {
	ref       string
	orgID     string
	force     bool
	confirmer clioutput.Confirmer
	renderer  clioutput.Renderer
	client    *stigmer.Client
}

// isDeleteOrganizationType checks if the type arg refers to organizations.
func isDeleteOrganizationType(typeArg string) bool {
	return isOrganizationType(typeArg)
}

func executeDelete(opts deleteOptions) error {
	if isDeleteExecutionType(opts.TypeArg) {
		return executeCancelExecution(opts)
	}

	// Organizations use FindMyOrganizations and don't need org context
	if isDeleteOrganizationType(opts.TypeArg) {
		return executeDeleteOrganization(opts)
	}

	reg := types.DefaultRegistry()
	info, ok := reg.GetByAlias(opts.TypeArg)
	if !ok {
		return fmt.Errorf("unknown resource type: %s\n\nAvailable types: agent, workflow, mcpserver, project, skill, execution, organization", opts.TypeArg)
	}

	if !info.SupportsVerb(types.VerbDelete) {
		return formatUnsupportedVerbError(info, types.VerbDelete)
	}

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

	dctx := &deleteContext{
		ref:       opts.Reference,
		orgID:     orgID,
		force:     opts.Force,
		confirmer: clioutput.NewConfirmer(opts.Force, os.Stderr),
		renderer:  clioutput.NewRenderer(opts.OutputFormat, os.Stdout, os.Stderr),
		client:    client,
	}
	return routeDelete(info, dctx)
}

// executeDeleteOrganization handles the special case of deleting an organization.
// Organizations don't require org context - they're looked up directly by slug or ID.
func executeDeleteOrganization(opts deleteOptions) error {
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

	renderer := clioutput.NewRenderer(opts.OutputFormat, os.Stdout, os.Stderr)
	confirmer := clioutput.NewConfirmer(opts.Force, os.Stderr)

	orgRes, err := organization.GetFromBackend(client, opts.Reference)
	if err != nil {
		return err
	}

	if !opts.Force {
		warn := clioutput.Warning("You are about to delete the following organization:")
		warn.AddSection("").
			Field("ID", orgRes.GetMetadata().GetId()).
			Field("Name", orgRes.GetMetadata().GetName()).
			Field("Slug", orgRes.GetMetadata().GetSlug())
		warn.Hint("This will delete the organization and all its resources.")
		warn.Hint("This action cannot be undone.")
		renderer.Render(warn)

		confirmed, err := confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := organization.Delete(&organization.DeleteOptions{
		OrganizationID: orgRes.GetMetadata().GetId(),
		Client:         client,
	})
	if err != nil {
		return err
	}

	out := clioutput.Success("Organization deleted successfully")
	out.AddSection("Deleted Organization").
		Field("ID", result.Organization.GetMetadata().GetId()).
		Field("Name", result.Organization.GetMetadata().GetName()).
		Field("Slug", result.Organization.GetMetadata().GetSlug())
	renderer.Render(out)
	return nil
}

func routeDelete(info *types.TypeInfo, dctx *deleteContext) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return deleteAgent(dctx)
	case apiresourcekind.ApiResourceKind_workflow:
		return deleteWorkflow(dctx)
	case apiresourcekind.ApiResourceKind_mcp_server:
		return deleteMcpServer(dctx)
	case apiresourcekind.ApiResourceKind_project:
		return deleteProject(dctx)
	case apiresourcekind.ApiResourceKind_skill:
		return deleteSkill(dctx)
	case apiresourcekind.ApiResourceKind_api_key:
		return deleteApiKey(dctx)
	default:
		return fmt.Errorf("delete not implemented for %s", info.DisplayName)
	}
}
