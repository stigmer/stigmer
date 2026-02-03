package root

import (
	"fmt"

	"github.com/AlecAivazis/survey/v2"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// newAgentDeleteCommand creates the agent delete subcommand.
func newAgentDeleteCommand() *cobra.Command {
	var force bool
	var orgOverride string

	cmd := &cobra.Command{
		Use:   "delete <name-or-id>",
		Short: "Delete an agent",
		Long: `Delete an agent by name (slug) or resource ID.

This operation is permanent and cannot be undone. By default, the command
will prompt for confirmation. Use --force to skip the confirmation prompt.

The command automatically detects whether the argument is a resource ID
or a name/slug and uses the appropriate lookup method.`,
		Example: `  # Delete by name (with confirmation)
  stigmer agent delete my-agent

  # Delete by org/slug (with confirmation)
  stigmer agent delete stigmer/code-reviewer

  # Delete by resource ID (with confirmation)
  stigmer agent delete agt_abc123

  # Force delete (skip confirmation)
  stigmer agent delete my-agent --force

  # Delete from specific organization
  stigmer agent delete my-agent --org acme-corp`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			reference := args[0]

			err := executeAgentDelete(agentDeleteOptions{
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

// agentDeleteOptions contains options for the delete operation.
type agentDeleteOptions struct {
	Reference   string
	OrgOverride string
	Force       bool
}

// executeAgentDelete handles the agent delete operation.
func executeAgentDelete(opts agentDeleteOptions) error {
	// Step 1: Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Step 2: Resolve organization
	orgID, err := resolveAgentOrganization(cfg, opts.OrgOverride)
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

	// Step 5: Fetch agent to confirm existence and get details
	existingAgent, err := agent.GetFromBackend(conn, orgID, opts.Reference)
	if err != nil {
		return fmt.Errorf("agent not found: %w", err)
	}

	// Step 6: Confirm deletion (unless --force)
	if !opts.Force {
		confirmed, err := confirmAgentDeletion(existingAgent.Metadata.Name)
		if err != nil {
			return fmt.Errorf("confirmation failed: %w", err)
		}
		if !confirmed {
			fmt.Println()
			fmt.Println("Delete operation cancelled.")
			return nil
		}
	}

	// Step 7: Delete the agent
	result, err := agent.Delete(&agent.DeleteOptions{
		AgentID: existingAgent.Metadata.Id,
		Conn:    conn,
	})
	if err != nil {
		return err
	}

	// Step 8: Display success
	agent.DisplayDeleteResult(result)

	return nil
}

// confirmAgentDeletion prompts the user to confirm agent deletion.
// Returns true if the user confirms, false otherwise.
func confirmAgentDeletion(agentName string) (bool, error) {
	var confirmed bool
	prompt := &survey.Confirm{
		Message: fmt.Sprintf("Delete agent '%s'? This cannot be undone.", agentName),
		Default: false,
	}

	if err := survey.AskOne(prompt, &confirmed); err != nil {
		return false, err
	}

	return confirmed, nil
}
