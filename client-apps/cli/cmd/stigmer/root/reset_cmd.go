package root

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewResetCommand creates the top-level 'stigmer reset' command.
func NewResetCommand() *cobra.Command {
	var force, includeConfig bool

	cmd := &cobra.Command{
		Use:   "reset",
		Short: "Reset local environment to a fresh state",
		Long: `Stop all services and remove all persistent state — the SQLite database,
skill artifacts, sessions, runtimes, Temporal state, logs, and downloaded
binaries — then automatically restart the server fresh.

Configuration (config.yaml) is preserved by default. Use --include-config
to also remove it; the setup wizard will run again on next start.`,
		Example: `  # Reset and restart
  stigmer reset

  # Reset without confirmation prompt
  stigmer reset --force

  # Full reset including configuration
  stigmer reset --include-config`,
		Run: func(cmd *cobra.Command, args []string) {
			handleReset(force, includeConfig)
		},
	}

	cmd.Flags().BoolVar(&force, "force", false, "Skip confirmation prompt")
	cmd.Flags().BoolVar(&includeConfig, "include-config", false,
		"Also remove configuration (API keys, backend preferences)")

	return cmd
}

func handleReset(force, includeConfig bool) {
	configDir, err := config.GetConfigDir()
	if err != nil {
		climsg.Error("Failed to determine config directory")
		clierr.Handle(err)
		return
	}

	dataDir, err := config.GetDataDir()
	if err != nil {
		climsg.Error("Failed to determine data directory")
		clierr.Handle(err)
		return
	}

	confirmer := clioutput.NewConfirmer(force, os.Stderr)

	prompt := buildResetPrompt(configDir, includeConfig)
	confirmed, err := confirmer.Confirm(prompt)
	if err != nil {
		climsg.Error("Failed to read confirmation")
		clierr.Handle(err)
		return
	}
	if !confirmed {
		climsg.Info("Reset cancelled")
		return
	}

	climsg.Info("Resetting Stigmer environment...")

	result, err := daemon.Reset(configDir, dataDir, daemon.ResetOptions{
		IncludeConfig: includeConfig,
	})
	if err != nil {
		climsg.Error("Reset failed")
		clierr.Handle(err)
		return
	}

	printResetSummary(result, includeConfig)

	if includeConfig {
		return
	}

	fmt.Fprintln(os.Stderr)
	startServerFresh(dataDir, daemon.StartOptions{}, clioutput.FormatHuman, false)
}

func buildResetPrompt(configDir string, includeConfig bool) string {
	msg := fmt.Sprintf("This will remove all runtime data in %s", configDir)
	if includeConfig {
		msg += " INCLUDING configuration (config.yaml)"
	} else {
		msg += " (configuration will be preserved)"
	}
	return msg + "\nContinue? [y/N]"
}

func printResetSummary(result *daemon.ResetResult, includeConfig bool) {
	if result.ServicesStopped {
		climsg.Success("Services stopped")
	}
	for _, p := range result.RemovedPaths {
		climsg.Success("Removed %s", p)
	}

	climsg.Success("Reset complete")
	if includeConfig {
		climsg.Info("Run 'stigmer up' to reconfigure and start fresh")
	}
}
