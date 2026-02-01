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

Workflows are SDK-synthesized resources that define multi-step automation
with complex orchestration logic. Unlike agents (which are YAML-based),
workflows require Go SDK code to define tasks, dependencies, and execution flow.

WORKFLOW LIFECYCLE:

  1. Define workflow using Go SDK (github.com/stigmer/stigmer-sdk-go/workflow)
  2. Deploy via 'stigmer apply' (runs SDK code, synthesizes resources)
  3. Execute via 'stigmer workflow run'
  4. Manage via 'stigmer workflow get/delete/search'

WHY SDK-BASED (NOT YAML):

  Workflows use the Go SDK because they require:
  - Complex orchestration with conditional logic and loops
  - Implicit dependency tracking between tasks
  - Programmatic task generation based on inputs
  - Type-safe task definitions with compile-time validation

COMPARISON WITH AGENTS:

  Agents (YAML-first):
  - Declarative configuration
  - Applied via 'stigmer agent apply'
  - Simple to define, no code required

  Workflows (SDK-first):
  - Programmatic definition
  - Applied via 'stigmer apply' (runs Go code)
  - Powerful orchestration capabilities`,
		Example: `  # Get a workflow by name
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
  stigmer wf get my-workflow
  stigmer wf run my-workflow`,
	}

	cmd.AddCommand(newWorkflowGetCommand())
	cmd.AddCommand(newWorkflowDeleteCommand())
	cmd.AddCommand(newWorkflowListCommand())

	// Subcommands to be registered in future sub-tasks:
	// - Sub-task 6: newWorkflowSearchCommand()
	// - Sub-task 7: newWorkflowRunCommand()

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
