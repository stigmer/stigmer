package stigmer

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root"
)

var rootCmd = &cobra.Command{
	Use:   "stigmer",
	Short: "Stigmer - Workflow as Code",
	Long: `Stigmer is an open-source agentic automation platform.

Build AI agents and workflows with zero infrastructure.
Run locally with BadgerDB or scale to production with Stigmer Cloud.`,
	SilenceErrors: true,
	SilenceUsage:  true,
}

func init() {
	// Add subcommands
	rootCmd.AddCommand(root.NewInitCommand())
	rootCmd.AddCommand(root.NewDevCommand())
	rootCmd.AddCommand(root.NewBackendCommand())
	rootCmd.AddCommand(root.NewAgentCommand())
	rootCmd.AddCommand(root.NewWorkflowCommand())
	rootCmd.AddCommand(root.NewVersionCommand())
}

// Execute runs the root command
func Execute() error {
	return rootCmd.Execute()
}
