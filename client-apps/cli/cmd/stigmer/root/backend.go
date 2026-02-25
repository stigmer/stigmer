package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewBackendCommand creates the backend command
func NewBackendCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "backend",
		Short: "Manage backend configuration",
		Long: `Manage backend configuration (local vs cloud).

Local:  Uses local daemon on localhost:7234
Cloud:  Uses Stigmer Cloud API`,
	}

	cmd.AddCommand(newBackendStatusCommand())
	cmd.AddCommand(newBackendSetCommand())

	return cmd
}

func newBackendStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show current backend",
		Run: func(cmd *cobra.Command, args []string) {
			handleBackendStatus()
		},
	}
}

func newBackendSetCommand() *cobra.Command {
	return &cobra.Command{
		Use:       "set <local|cloud>",
		Short:     "Set backend type",
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{"local", "cloud"},
		Run: func(cmd *cobra.Command, args []string) {
			handleBackendSet(args[0])
		},
	}
}

func handleBackendStatus() {
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	result := clioutput.Success("Backend configuration")
	sec := result.AddSection("").
		Field("Type", string(cfg.Backend.Type))

	if cfg.Backend.Type == config.BackendTypeLocal {
		if cfg.Backend.Local != nil {
			sec.Field("Endpoint", cfg.Backend.Local.Endpoint).
				Field("Data Dir", cfg.Backend.Local.DataDir)
		}
	} else if cfg.Backend.Type == config.BackendTypeCloud {
		if cfg.Backend.Cloud != nil {
			sec.Field("Endpoint", cfg.Backend.Cloud.Endpoint)
			if cfg.Backend.Cloud.Token != "" {
				sec.Field("Auth", "Logged in ✓")
			} else {
				sec.Field("Auth", "Not logged in ✗")
			}
		}
	}

	renderer.Render(result)
}

func handleBackendSet(backendType string) {
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	switch backendType {
	case "local":
		cfg.Backend.Type = config.BackendTypeLocal
		if cfg.Backend.Local == nil {
			cfg.Backend.Local = &config.LocalBackendConfig{}
		}

		if err := config.Save(cfg); err != nil {
			clierr.Handle(err)
			return
		}

		result := clioutput.Success("Backend set to local")
		result.Hint("Make sure the server is running:")
		result.Hint("  stigmer server status")
		result.Hint("  stigmer server")
		renderer.Render(result)

	case "cloud":
		cfg.Backend.Type = config.BackendTypeCloud
		if cfg.Backend.Cloud == nil {
			cfg.Backend.Cloud = &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
			}
		}

		if err := config.Save(cfg); err != nil {
			clierr.Handle(err)
			return
		}

		result := clioutput.Success("Backend set to cloud")
		result.Hint("Please authenticate:")
		result.Hint("  stigmer login")
		renderer.Render(result)

	default:
		result := clioutput.Error("Invalid backend type: %s", backendType)
		result.Hint("Valid types: local, cloud")
		renderer.Render(result)
	}
}
