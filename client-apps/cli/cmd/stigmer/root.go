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
	Short: "Stigmer - Workflow as Code",
	Long: `Stigmer is an open-source agentic automation platform.

Build AI agents and workflows with zero infrastructure.
Run locally with BadgerDB or scale to production with Stigmer Cloud.`,
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
	// Add global debug flag
	rootCmd.PersistentFlags().BoolVarP(&debugMode, "debug", "d", false, "enable debug mode with detailed logs")
	
	// Add subcommands
	rootCmd.AddCommand(root.NewServerCommand())
	rootCmd.AddCommand(root.NewBackendCommand())
}

// Execute runs the root command
func Execute() error {
	return rootCmd.Execute()
}
