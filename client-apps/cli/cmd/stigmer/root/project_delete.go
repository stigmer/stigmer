package root

import (
	"fmt"

	"github.com/AlecAivazis/survey/v2"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
)

// newProjectDeleteCommand creates the project delete subcommand.
func newProjectDeleteCommand() *cobra.Command {
	var force bool
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "delete <name-or-id>",
		Short: "Delete a project",
		Long: `Delete a project by name (slug) or resource ID.

This operation is permanent and cannot be undone. By default, the command
will prompt for confirmation. Use --force to skip the confirmation prompt.

The command automatically detects whether the argument is a resource ID
or a name/slug and uses the appropriate lookup method.

WARNING: Deleting a project may affect associated resources (agents,
workflows, skills, MCP servers) that were deployed as part of this project.`,
		Example: `  # Delete by name (with confirmation)
  stigmer project delete my-project

  # Delete by org/slug (with confirmation)
  stigmer project delete stigmer/ai-assistant

  # Delete by resource ID (with confirmation)
  stigmer project delete prj_abc123

  # Force delete (skip confirmation)
  stigmer project delete my-project --force

  # Delete from specific organization
  stigmer project delete my-project --org acme-corp

  # Use the 'proj' alias
  stigmer proj delete my-project`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			err := executeProjectDelete(projectDeleteOptions{
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

// projectDeleteOptions contains options for the delete operation.
type projectDeleteOptions struct {
	Reference   string
	OrgOverride string
	Force       bool
}

// executeProjectDelete handles the project delete operation.
func executeProjectDelete(opts projectDeleteOptions) error {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Step 2: Resolve organization
	orgID, err := resolveProjectOrganization(cfg, opts.OrgOverride)
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

	// Step 5: Fetch project to confirm existence and get details
	existingProject, err := project.GetFromBackend(conn, orgID, opts.Reference)
	if err != nil {
		return fmt.Errorf("project not found: %w", err)
	}

	// Step 6: Confirm deletion (unless --force)
	if !opts.Force {
		confirmed, err := confirmProjectDeletion(existingProject.Metadata.Name)
		if err != nil {
			return fmt.Errorf("confirmation failed: %w", err)
		}
		if !confirmed {
			fmt.Println()
			fmt.Println("Delete operation cancelled.")
			return nil
		}
	}

	// Step 7: Delete the project
	result, err := project.Delete(&project.DeleteOptions{
		ProjectID: existingProject.Metadata.Id,
		Conn:      conn,
	})
	if err != nil {
		return err
	}

	// Step 8: Display success
	project.DisplayDeleteResult(result)

	return nil
}

// confirmProjectDeletion prompts the user to confirm project deletion.
// Returns true if the user confirms, false otherwise.
func confirmProjectDeletion(projectName string) (bool, error) {
	var confirmed bool
	prompt := &survey.Confirm{
		Message: fmt.Sprintf("Delete project '%s'? This cannot be undone.", projectName),
		Default: false,
	}

	if err := survey.AskOne(prompt, &confirmed); err != nil {
		return false, err
	}

	return confirmed, nil
}
