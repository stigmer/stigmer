package root

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
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
		Use:   "set <local|cloud>",
		Short: "Set backend type",
		Args:  cobra.ExactArgs(1),
		ValidArgs: []string{"local", "cloud"},
		Run: func(cmd *cobra.Command, args []string) {
			handleBackendSet(args[0])
		},
	}
}

func handleBackendStatus() {
	cfg, err := config.Load()
	if err != nil {
		cliprint.Error("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	fmt.Println("Backend Configuration:")
	fmt.Println("─────────────────────────────────────")
	cliprint.Info("  Type: %s", cfg.Backend.Type)
	
	if cfg.Backend.Type == config.BackendTypeLocal {
		if cfg.Backend.Local != nil {
			cliprint.Info("  Endpoint: %s", cfg.Backend.Local.Endpoint)
			cliprint.Info("  Data Dir: %s", cfg.Backend.Local.DataDir)
		}
	} else if cfg.Backend.Type == config.BackendTypeCloud {
		if cfg.Backend.Cloud != nil {
			cliprint.Info("  Endpoint: %s", cfg.Backend.Cloud.Endpoint)
			if cfg.Backend.Cloud.Token != "" {
				cliprint.Info("  Auth: ✓ Logged in")
			} else {
				cliprint.Warning("  Auth: ✗ Not logged in")
			}
		}
	}
}

func handleBackendSet(backendType string) {
	cfg, err := config.Load()
	if err != nil {
		cliprint.Error("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	switch backendType {
	case "local":
		dataDir, _ := config.GetDataDir()
		cfg.Backend.Type = config.BackendTypeLocal
		if cfg.Backend.Local == nil {
			cfg.Backend.Local = &config.LocalBackendConfig{
				Endpoint: "localhost:7234",
				DataDir:  dataDir,
			}
		}
		
		if err := config.Save(cfg); err != nil {
			cliprint.Error("Failed to save configuration")
			clierr.Handle(err)
			return
		}

		cliprint.Success("Backend set to local")
		cliprint.Info("")
		cliprint.Info("Make sure the server is running:")
		cliprint.Info("  stigmer server status")
		cliprint.Info("  stigmer server")

	case "cloud":
		cfg.Backend.Type = config.BackendTypeCloud
		if cfg.Backend.Cloud == nil {
			cfg.Backend.Cloud = &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
			}
		}
		
		if err := config.Save(cfg); err != nil {
			cliprint.Error("Failed to save configuration")
			clierr.Handle(err)
			return
		}

		cliprint.Success("Backend set to cloud")
		cliprint.Info("")
		cliprint.Info("Please authenticate:")
		cliprint.Info("  stigmer login")

	default:
		cliprint.Error("Invalid backend type: %s", backendType)
		cliprint.Info("Valid types: local, cloud")
	}
}
