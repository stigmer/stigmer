package root

import (
	"context"
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

func newUsageAgentCommand() *cobra.Command {
	var fromDate, toDate, outputFormat string

	cmd := &cobra.Command{
		Use:   "agent <agent-id>",
		Short: "View usage report for an agent",
		Long: `View aggregated token usage, cost, and model breakdown for an agent
across all its sessions within an optional date range.

Shows summary statistics, per-model cost breakdown, and per-session detail.`,
		Example: `  # View all-time usage for an agent
  stigmer usage agent my-coding-assistant

  # View usage within a date range
  stigmer usage agent my-coding-assistant --from 2026-03-01 --to 2026-03-13

  # Output as JSON
  stigmer usage agent my-coding-assistant --output json`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeUsageAgent(args[0], fromDate, toDate, outputFormat)
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVar(&fromDate, "from", "", "start date (ISO 8601, e.g. 2026-03-01)")
	cmd.Flags().StringVar(&toDate, "to", "", "end date (ISO 8601, e.g. 2026-03-13)")
	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, json, yaml")

	return cmd
}

func executeUsageAgent(agentID, fromDate, toDate, outputFormat string) error {
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()

	report, err := client.AgentExecution.GetAgentUsageReport(context.Background(), &agentexecutionv1.GetAgentUsageReportInput{
		AgentId:  agentID,
		FromDate: fromDate,
		ToDate:   toDate,
	})
	if err != nil {
		return errors.Wrap(err, "failed to get agent usage report")
	}

	switch outputFormat {
	case "json":
		return writeReportJSON(report)
	case "yaml":
		return writeReportYAML(report)
	default:
		renderAgentUsageTable(report, fromDate, toDate)
		return nil
	}
}

func renderAgentUsageTable(report *agentexecutionv1.GetAgentUsageReportOutput, fromDate, toDate string) {
	fmt.Println()

	// Header
	name := report.GetAgentName()
	if name == "" {
		name = report.GetAgentId()
	}
	fmt.Printf("Agent:  %s\n", name)
	if fromDate != "" || toDate != "" {
		fmt.Printf("Period: %s\n", formatInputDateRange(fromDate, toDate))
	}
	fmt.Println()

	// Summary stats
	fmt.Printf("  Sessions:     %d\n", report.GetTotalSessions())
	fmt.Printf("  Executions:   %d\n", report.GetTotalExecutions())
	fmt.Printf("  Total cost:   %s\n", formatCost(report.GetTotalCostUsd()))
	if report.GetTotalExecutions() > 0 {
		avg := report.GetTotalCostUsd() / float64(report.GetTotalExecutions())
		fmt.Printf("  Avg/exec:     %s\n", formatCost(avg))
	}
	fmt.Println()

	// Model breakdown table
	if len(report.GetModelBreakdown()) > 0 {
		headerColor := color.New(color.FgCyan).SprintFunc()
		tbl := display.NewTable(
			[]string{"MODEL", "TOKENS", "COST", "SHARE"},
			display.WithHeaderColor(headerColor),
			display.WithAdaptive(),
		)

		totalCost := report.GetTotalCostUsd()
		for _, m := range report.GetModelBreakdown() {
			totalTokens := m.GetInputTokens() + m.GetOutputTokens() + m.GetCacheCreationTokens() + m.GetCacheReadTokens()
			tbl.AddRow(
				m.GetModel(),
				formatTokenCount(totalTokens),
				formatCost(m.GetEstimatedCostUsd()),
				formatShare(m.GetEstimatedCostUsd(), totalCost),
			)
		}

		tbl.Render(os.Stdout)
		fmt.Println()
	}

	// Session breakdown table
	if len(report.GetSessions()) > 0 {
		headerColor := color.New(color.FgCyan).SprintFunc()
		tbl := display.NewTable(
			[]string{"#", "PERIOD", "EXECUTIONS", "COST"},
			display.WithHeaderColor(headerColor),
			display.WithAdaptive(),
		)

		for i, sess := range report.GetSessions() {
			period := formatDateRange(sess.GetFirstExecutionAt(), sess.GetLastExecutionAt())
			tbl.AddRow(
				fmt.Sprintf("%d", i+1),
				period,
				fmt.Sprintf("%d", sess.GetExecutionCount()),
				formatCost(sess.GetEstimatedCostUsd()),
			)
		}

		tbl.Render(os.Stdout)
	}

	fmt.Println()
}

// formatInputDateRange formats user-provided date strings for display.
// Unlike formatDateRange which parses RFC3339, this handles plain date strings
// (e.g. "2026-03-01") that users pass via --from/--to flags.
func formatInputDateRange(from, to string) string {
	if from == "" && to == "" {
		return ""
	}
	if from == "" {
		return "to " + to
	}
	if to == "" {
		return "from " + from
	}
	return from + " to " + to
}
