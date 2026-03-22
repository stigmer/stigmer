package root

import (
	"os"

	"github.com/rs/zerolog"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/seedpackbootstrap"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewSeedpackCommand creates the seedpack command group.
func NewSeedpackCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "seedpack",
		Short: "Manage system seedpack resources",
		Long: `Manage the embedded system seedpack — the built-in agents, skills,
and MCP server definitions that ship with the CLI.

The seedpack contains system resources (agent-creator, skill-creator,
mcp-server-creator, assistant) under the "stigmer" organization.

In local mode, the seedpack is applied automatically on server startup.
In cloud mode, use 'stigmer seedpack apply' to bootstrap the cloud
backend with these system resources.`,
	}

	cmd.AddCommand(newSeedpackApplyCommand())
	cmd.AddCommand(newSeedpackStatusCommand())

	return cmd
}

func newSeedpackApplyCommand() *cobra.Command {
	var force bool
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "apply",
		Short: "Apply seedpack to the configured backend",
		Long: `Extract the embedded seedpack and apply it to whatever backend the
CLI is currently configured for (local or cloud).

The apply is idempotent: if the seedpack content has not changed since
the last successful apply, the operation is skipped. Use --force to
re-apply unconditionally.

The target organization defaults to "stigmer" and can be overridden
via the STIGMER_SEEDPACK_ORG environment variable.`,
		Example: `  # Apply seedpack to the current backend
  stigmer seedpack apply

  # Force re-apply even if already up to date
  stigmer seedpack apply --force

  # Apply to a cloud backend
  stigmer config backend set cloud
  stigmer auth login
  stigmer seedpack apply`,
		Run: func(cmd *cobra.Command, args []string) {
			handleSeedpackApply(force, resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	cmd.Flags().BoolVar(&force, "force", false, "re-apply even if the seedpack has not changed")
	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)

	return cmd
}

func handleSeedpackApply(force bool, format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	markerDir, err := resolveMarkerDir()
	if err != nil {
		clierr.Handle(err)
		return
	}

	err = seedpackbootstrap.Apply(seedpackbootstrap.Options{
		MarkerDir: markerDir,
		Force:     force,
		Verbose:   zerolog.GlobalLevel() <= zerolog.DebugLevel,
	})
	if err != nil {
		clierr.Handle(err)
		return
	}

	result := clioutput.Success("Seedpack applied to %s backend", resolveBackendLabel())
	renderer.Render(result)
}

func newSeedpackStatusCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show seedpack bootstrap status",
		Long:  `Check whether the embedded seedpack has been applied to the current backend.`,
		Run: func(cmd *cobra.Command, args []string) {
			handleSeedpackStatus(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func handleSeedpackStatus(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	hash, err := seedpackbootstrap.CurrentHash()
	if err != nil {
		clierr.Handle(err)
		return
	}

	markerDir, err := resolveMarkerDir()
	if err != nil {
		clierr.Handle(err)
		return
	}

	applied, storedHash := seedpackbootstrap.MarkerStatus(markerDir)

	result := clioutput.Success("Seedpack status")
	sec := result.AddSection("")
	sec.Field("Backend", resolveBackendLabel())
	sec.Field("Embedded Hash", hash)

	if applied {
		sec.Field("Applied Hash", storedHash)
		if storedHash == hash {
			sec.Field("Status", "Up to date")
		} else {
			sec.Field("Status", "Outdated (run 'stigmer seedpack apply' to update)")
		}
	} else {
		sec.Field("Status", "Not applied (run 'stigmer seedpack apply')")
	}

	renderer.Render(result)
}

// resolveMarkerDir returns the directory for the seedpack idempotency marker,
// based on the current backend type.
func resolveMarkerDir() (string, error) {
	cfg, err := config.Load()
	if err != nil {
		return "", err
	}

	configDir, err := config.GetConfigDir()
	if err != nil {
		return "", err
	}

	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		dataDir, err := config.GetDataDir()
		if err != nil {
			return "", err
		}
		return dataDir, nil
	default:
		return configDir, nil
	}
}

// resolveBackendLabel returns a human-readable label for the current backend.
func resolveBackendLabel() string {
	cfg, err := config.Load()
	if err != nil {
		return "unknown"
	}

	switch cfg.Backend.Type {
	case config.BackendTypeCloud:
		endpoint := "api.stigmer.ai:443"
		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.Endpoint != "" {
			endpoint = cfg.Backend.Cloud.Endpoint
		}
		return "cloud (" + endpoint + ")"
	default:
		return "local"
	}
}
