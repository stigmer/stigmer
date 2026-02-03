package root

import (
	"fmt"

	"github.com/AlecAivazis/survey/v2"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
)

// newWorkflowDeleteCommand creates the workflow delete subcommand.
func newWorkflowDeleteCommand() *cobra.Command {
	var force bool
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "delete <name-or-id>",
		Short: "Delete a workflow",
		Long: `Delete a workflow by name (slug) or resource ID.

This operation is permanent and cannot be undone. By default, the command
will prompt for confirmation. Use --force to skip the confirmation prompt.

The command automatically detects whether the argument is a resource ID
or a name/slug and uses the appropriate lookup method.`,
		Example: `  # Delete by name (with confirmation)
  stigmer workflow delete my-workflow

  # Delete by org/slug (with confirmation)
  stigmer workflow delete stigmer/deploy-pipeline

  # Delete by resource ID (with confirmation)
  stigmer workflow delete wfl_abc123

  # Force delete (skip confirmation)
  stigmer workflow delete my-workflow --force

  # Delete from specific organization
  stigmer workflow delete my-workflow --org acme-corp

  # Use the 'wf' alias for brevity
  stigmer wf delete my-workflow`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			err := executeWorkflowDelete(workflowDeleteOptions{
				Reference:   reference,
				OrgOverride: orgOverride,
				Force:       force,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().BoolVarP(&force, "force", "f", false, "skip confirmation prompt")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides context)")

	return cmd
}

// workflowDeleteOptions contains options for the delete operation.
type workflowDeleteOptions struct {
	Reference   string
	OrgOverride string
	Force       bool
}

// executeWorkflowDelete handles the workflow delete operation.
func executeWorkflowDelete(opts workflowDeleteOptions) error {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Step 2: Resolve organization
	orgID, err := resolveWorkflowOrganization(cfg, opts.OrgOverride)
	if err != nil {
		return err
	}

	// Step 3: Ensure daemon running (local mode)
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return err
		}

		if err := daemon.EnsureRunning(dataDir); err != nil {
			return err
		}
	}

	// Step 4: Connect to backend
	conn, err := backend.NewConnection()
	if err != nil {
		return err
	}
	defer conn.Close()

	// Step 5: Fetch workflow to confirm existence and get details
	existingWorkflow, err := workflow.GetFromBackend(conn, orgID, opts.Reference)
	if err != nil {
		return fmt.Errorf("workflow not found: %w", err)
	}

	// Step 6: Confirm deletion (unless --force)
	if !opts.Force {
		confirmed, err := confirmWorkflowDeletion(existingWorkflow.Metadata.Name)
		if err != nil {
			return fmt.Errorf("confirmation failed: %w", err)
		}
		if !confirmed {
			fmt.Println()
			fmt.Println("Delete operation cancelled.")
			return nil
		}
	}

	// Step 7: Delete the workflow
	result, err := workflow.Delete(&workflow.DeleteOptions{
		WorkflowID: existingWorkflow.Metadata.Id,
		Conn:       conn,
	})
	if err != nil {
		return err
	}

	// Step 8: Display success
	workflow.DisplayDeleteResult(result)

	return nil
}

// confirmWorkflowDeletion prompts the user to confirm workflow deletion.
// Returns true if the user confirms, false otherwise.
func confirmWorkflowDeletion(workflowName string) (bool, error) {
	var confirmed bool
	prompt := &survey.Confirm{
		Message: fmt.Sprintf("Delete workflow '%s'? This cannot be undone.", workflowName),
		Default: false,
	}

	if err := survey.AskOne(prompt, &confirmed); err != nil {
		return false, err
	}

	return confirmed, nil
}
