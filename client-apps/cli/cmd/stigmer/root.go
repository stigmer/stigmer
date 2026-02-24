package stigmer

import (
	"os"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root"
)

var (
	debugMode bool
)

var rootCmd = &cobra.Command{
	Use:   "stigmer",
	Short: "Stigmer - Agentic Automation Platform",
	Long: `Stigmer is an open-source agentic automation platform.

Build, run, and orchestrate AI agents with zero infrastructure.
Run locally or scale to production with Stigmer Cloud.`,
	SilenceErrors: true,
	SilenceUsage:  true,
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		// Configure zerolog based on debug flag
		if debugMode {
			// Debug mode: pretty console output with debug level
			log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
			zerolog.SetGlobalLevel(zerolog.DebugLevel)
		} else {
			// Normal mode: disable zerolog output (only show user-friendly messages)
			zerolog.SetGlobalLevel(zerolog.Disabled)
		}
	},
}

func init() {
	rootCmd.PersistentFlags().BoolVarP(&debugMode, "debug", "d", false, "enable debug mode with detailed logs")

	rootCmd.AddGroup(
		&cobra.Group{ID: "core", Title: "Core Commands:"},
		&cobra.Group{ID: "resource", Title: "Resource Management:"},
		&cobra.Group{ID: "artifact", Title: "Artifact Commands:"},
		&cobra.Group{ID: "server", Title: "Server Commands:"},
		&cobra.Group{ID: "config", Title: "Configuration:"},
	)

	// Core Commands
	rootCmd.AddCommand(withGroup(root.NewRunCommand(), "core"))

	// Resource Management
	rootCmd.AddCommand(withGroup(root.NewApplyCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewGetCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewListCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewDeleteCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewValidateCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewSearchCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewDraftCommand(), "resource"))

	// Artifact Commands
	rootCmd.AddCommand(withGroup(root.NewPushCommand(), "artifact"))
	rootCmd.AddCommand(withGroup(root.NewDownloadCommand(), "artifact"))

	// Server Commands
	rootCmd.AddCommand(withGroup(root.NewServerCommand(), "server"))
	rootCmd.AddCommand(withGroup(root.NewMCPServerCommand(), "server"))

	// Configuration
	rootCmd.AddCommand(withGroup(root.NewBackendCommand(), "config"))
	rootCmd.AddCommand(withGroup(root.NewConfigCommand(), "config"))
	rootCmd.AddCommand(withGroup(root.NewResourcesCommand(), "config"))
	rootCmd.AddCommand(withGroup(root.NewCompletionCommand(), "config"))

	// Hidden internal commands (no group needed)
	rootCmd.AddCommand(root.NewInternalServerCommand())
	rootCmd.AddCommand(root.NewInternalWorkflowRunnerCommand())
}

func withGroup(cmd *cobra.Command, groupID string) *cobra.Command {
	cmd.GroupID = groupID
	return cmd
}

// Execute runs the root command
func Execute() error {
	return rootCmd.Execute()
}

// GetRootCommand returns the root command for testing purposes
func GetRootCommand() *cobra.Command {
	return rootCmd
}
