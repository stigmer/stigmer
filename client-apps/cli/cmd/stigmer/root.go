package stigmer

import (
	"os"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	cliconfig "github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

var (
	debugMode      bool
	standaloneMode bool
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
		clierr.SetDebug(debugMode)

		if debugMode {
			log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
			zerolog.SetGlobalLevel(zerolog.DebugLevel)
		} else {
			zerolog.SetGlobalLevel(zerolog.Disabled)
		}

		if standaloneMode {
			cliconfig.SetStandalone()
		}

		if apiKey, _ := cmd.Flags().GetString("api-key"); apiKey != "" {
			os.Setenv("STIGMER_API_KEY", apiKey)
		}
	},
}

func init() {
	rootCmd.PersistentFlags().BoolVarP(&debugMode, "debug", "d", false, "enable debug mode with detailed logs")
	rootCmd.PersistentFlags().BoolVar(&standaloneMode, "standalone", false, "ignore config file; all config must come from flags or env vars")
	rootCmd.PersistentFlags().String("org", "", "organization slug (overrides context)")
	rootCmd.PersistentFlags().String("api-key", "", "API key for cloud authentication (overrides stored token)")

	rootCmd.AddGroup(
		&cobra.Group{ID: "core", Title: "Core Commands:"},
		&cobra.Group{ID: "lifecycle", Title: "Lifecycle:"},
		&cobra.Group{ID: "resource", Title: "Resource Management:"},
		&cobra.Group{ID: "artifact", Title: "Artifact Commands:"},
		&cobra.Group{ID: "server", Title: "Server Commands:"},
		&cobra.Group{ID: "config", Title: "Configuration:"},
	)

	// Core Commands
	rootCmd.AddCommand(withGroup(root.NewRunCommand(), "core"))
	rootCmd.AddCommand(withGroup(root.NewResumeCommand(), "core"))
	rootCmd.AddCommand(withGroup(root.NewUsageCommand(), "core"))

	// Lifecycle
	rootCmd.AddCommand(withGroup(root.NewUpCommand(), "lifecycle"))
	rootCmd.AddCommand(withGroup(root.NewDownCommand(), "lifecycle"))
	rootCmd.AddCommand(withGroup(root.NewStatusCommand(), "lifecycle"))
	rootCmd.AddCommand(withGroup(root.NewLogsCommand(), "lifecycle"))
	rootCmd.AddCommand(withGroup(root.NewSetupCommand(), "lifecycle"))
	rootCmd.AddCommand(withGroup(root.NewResetCommand(), "lifecycle"))

	// Resource Management
	rootCmd.AddCommand(withGroup(root.NewApplyCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewGetCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewListCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewDeleteCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewValidateCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewSearchCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewDraftCommand(), "resource"))
	rootCmd.AddCommand(withGroup(root.NewConnectCommand(), "resource"))

	// Artifact Commands
	rootCmd.AddCommand(withGroup(root.NewPushCommand(), "artifact"))
	rootCmd.AddCommand(withGroup(root.NewDownloadCommand(), "artifact"))

	// Server Commands
	rootCmd.AddCommand(withGroup(root.NewMCPServerCommand(), "server"))
	rootCmd.AddCommand(withGroup(root.NewSeedpackCommand(), "server"))

	// Configuration
	rootCmd.AddCommand(withGroup(root.NewAuthCommand(), "config"))
	rootCmd.AddCommand(withGroup(root.NewApiKeyCommand(), "config"))
	rootCmd.AddCommand(withGroup(root.NewConfigCommand(), "config"))
	rootCmd.AddCommand(withGroup(root.NewCompletionCommand(), "config"))
	rootCmd.AddCommand(withGroup(root.NewVersionCommand(), "config"))

	// Hidden internal commands (no group needed)
	rootCmd.AddCommand(root.NewInternalDaemonCommand())
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
