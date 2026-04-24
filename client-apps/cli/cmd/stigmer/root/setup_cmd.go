package root

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/setup"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// NewSetupCommand creates the top-level 'stigmer setup' command.
func NewSetupCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "setup",
		Short: "Configure LLM provider",
		Long: `Run the interactive setup wizard to configure your LLM provider.

This re-runs the same wizard shown on first startup. Use it to switch
between Anthropic, OpenAI, Ollama, or to add an API key after skipping
initial setup.

After changing the provider, restart the server to apply:
  stigmer down && stigmer up`,
		Run: func(cmd *cobra.Command, args []string) {
			handleSetup()
		},
	}
}

func handleSetup() {
	cfg, err := config.Load()
	if err != nil {
		cfg = config.GetDefault()
	}

	if err := setup.RunWizardInteractive(cfg); err != nil {
		climsg.Error("Setup failed: %v", err)
		clierr.Handle(err)
		return
	}

	if err := config.Save(cfg); err != nil {
		climsg.Error("Failed to save configuration")
		clierr.Handle(err)
		return
	}

	configPath, _ := config.GetConfigPath()
	climsg.Success("Configuration saved to %s", configPath)

	dataDir, _ := config.GetDataDir()
	if dataDir != "" && daemon.IsRunning(dataDir) {
		fmt.Fprintln(os.Stderr)
		climsg.Info("Server is running. Restart to apply changes:")
		climsg.Info("  stigmer down && stigmer up")
	}
}
