package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// NewWorkflowCommand creates the workflow management command group.
func NewWorkflowCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "workflow",
		Aliases: []string{"wf"},
		Short:   "Manage workflows",
		Long: `Manage workflow configurations and executions.

Workflows support two deployment methods:

  YAML-First (Atomic Track):
    Define workflows in YAML files and apply directly.
    Best for: Quick experiments, simple workflows, version control.
    Command: stigmer workflow apply workflow.yaml

  SDK-First (Project Track):
    Define workflows in Go code for complex orchestration.
    Best for: Production workflows, conditional logic, loops.
    Command: stigmer apply (runs SDK code)

WORKFLOW LIFECYCLE:

  YAML-based workflows:
    1. Create workflow.yaml with apiVersion, kind, metadata, spec
    2. Apply via 'stigmer workflow apply workflow.yaml'
    3. Execute via 'stigmer workflow run'
    4. Manage via 'stigmer workflow get/delete/search'

  SDK-based workflows:
    1. Define workflow using Go SDK (github.com/stigmer/stigmer-sdk-go/workflow)
    2. Deploy via 'stigmer apply' (runs SDK code, synthesizes resources)
    3. Execute via 'stigmer workflow run'
    4. Manage via 'stigmer workflow get/delete/search'`,
		Example: `  # Apply a workflow from YAML
  stigmer workflow apply workflow.yaml

  # Validate without applying (dry run)
  stigmer workflow apply workflow.yaml --dry-run

  # Get a workflow by name
  stigmer workflow get my-workflow

  # Get a workflow with YAML output
  stigmer workflow get my-workflow --output yaml

  # Run a workflow
  stigmer workflow run my-workflow

  # Run a workflow with an initial message
  stigmer workflow run my-workflow --message "Process the data"

  # Delete a workflow
  stigmer workflow delete my-workflow

  # Force delete without confirmation
  stigmer workflow delete my-workflow --force

  # Search for workflows
  stigmer workflow search "deploy"

  # Use the 'wf' alias for brevity
  stigmer wf apply workflow.yaml
  stigmer wf get my-workflow
  stigmer wf run my-workflow`,
	}

	cmd.AddCommand(newWorkflowApplyCommand())
	cmd.AddCommand(newWorkflowGetCommand())
	cmd.AddCommand(newWorkflowDeleteCommand())
	cmd.AddCommand(newWorkflowListCommand())
	cmd.AddCommand(newWorkflowSearchCommand())
	cmd.AddCommand(newWorkflowRunCommand())

	return cmd
}

// resolveWorkflowOrganization determines the organization ID based on backend type and overrides.
func resolveWorkflowOrganization(cfg *config.Config, orgOverride string) (string, error) {
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		orgID := "local"
		cliprint.PrintInfo("Using local backend (organization: %s)", orgID)
		return orgID, nil

	case config.BackendTypeCloud:
		if orgOverride != "" {
			cliprint.PrintInfo("Using organization from flag: %s", orgOverride)
			return orgOverride, nil
		}

		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.OrgID != "" {
			cliprint.PrintInfo("Using organization from context: %s", cfg.Backend.Cloud.OrgID)
			return cfg.Backend.Cloud.OrgID, nil
		}

		return "", fmt.Errorf("organization not set for cloud mode\n\nUse --org flag or run: stigmer context set --org <org-id>")

	default:
		return "", fmt.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}
}
