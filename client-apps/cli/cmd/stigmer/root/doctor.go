package root

import (
	"os"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// NewDoctorCommand creates the `stigmer doctor` diagnostic command.
func NewDoctorCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "doctor",
		Short: "Check system health and configuration",
		Long: `Run diagnostic checks to verify that Stigmer is correctly configured
and operational.

Checks performed:
  - Configuration file and backend settings
  - Server connectivity and latency
  - Authentication status
  - Organization context
  - Agent availability
  - MCP server health
  - Terminal capabilities

Exit code is 0 when all checks pass (or warn/skip), 1 when any check fails.
Use in CI/scripts as a pre-flight gate: stigmer doctor && stigmer run ...`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format := resolveResultFormat(jsonOutput, quietOutput)
			return executeDoctor(format)
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func executeDoctor(format clioutput.OutputFormat) error {
	cfg, err := config.Load()
	if err != nil {
		cfg = config.GetDefault()
	}

	var checks []checkResult

	checks = append(checks, checkConfig(cfg))

	serverResult, client := checkServer(cfg)
	checks = append(checks, serverResult)
	if client != nil {
		defer client.Close()
	}

	checks = append(checks, checkAuth(cfg))

	orgResult, orgID := checkOrg(cfg)
	checks = append(checks, orgResult)

	if client != nil && orgID != "" {
		checks = append(checks, checkAgents(client.Conn(), orgID))
	} else {
		checks = append(checks, skipCheck("Agents", "requires server connectivity and organization context"))
	}

	checks = append(checks, checkMCPHealth())
	checks = append(checks, checkTerminal())

	result, hasFailed := buildDoctorResult(checks)

	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)
	renderer.Render(result)

	if hasFailed {
		os.Exit(1)
	}
	return nil
}

// buildDoctorResult converts a slice of check outcomes into a single
// CommandResult. Returns the result and whether any check failed.
func buildDoctorResult(checks []checkResult) (*clioutput.CommandResult, bool) {
	var failCount, warnCount int
	for _, c := range checks {
		switch c.status {
		case statusFail:
			failCount++
		case statusWarn:
			warnCount++
		}
	}

	var result *clioutput.CommandResult
	switch {
	case failCount > 0:
		result = clioutput.Error("Stigmer Doctor — %d check(s) failed", failCount)
	case warnCount > 0:
		result = clioutput.Warning("Stigmer Doctor — %d warning(s)", warnCount)
	default:
		result = clioutput.Success("Stigmer Doctor — all checks passed")
	}

	for _, c := range checks {
		sec := result.AddSection(c.name)
		for _, f := range c.fields {
			sec.Field(f.key, f.value)
		}
		if c.hint != "" {
			result.Hint(c.hint)
		}
	}

	return result, failCount > 0
}
