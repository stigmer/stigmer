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

func newUsageOrgCommand() *cobra.Command {
	var fromDate, toDate, outputFormat string

	cmd := &cobra.Command{
		Use:   "org",
		Short: "View usage report for an organization",
		Long: `View aggregated token usage, cost, and model breakdown for an entire
organization within a date range.

Shows org-wide summary, per-model cost breakdown, top agents by cost,
and a daily cost trend.

The --from and --to flags are required. Organization is resolved from
the --org flag or the current CLI context.`,
		Example: `  # View org usage for March 2026
  stigmer usage org --from 2026-03-01 --to 2026-03-31

  # Specify organization explicitly
  stigmer usage org --from 2026-03-01 --to 2026-03-31 --org acme-corp

  # Output as JSON
  stigmer usage org --from 2026-03-01 --to 2026-03-31 --output json`,
		Run: func(cmd *cobra.Command, args []string) {
			err := executeUsageOrg(GetOrgFlag(cmd), fromDate, toDate, outputFormat)
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVar(&fromDate, "from", "", "start date (ISO 8601, e.g. 2026-03-01, required)")
	cmd.Flags().StringVar(&toDate, "to", "", "end date (ISO 8601, e.g. 2026-03-31, required)")
	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, json, yaml")

	_ = cmd.MarkFlagRequired("from")
	_ = cmd.MarkFlagRequired("to")

	return cmd
}

func executeUsageOrg(orgOverride, fromDate, toDate, outputFormat string) error {
	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveOrganization(cfg, orgOverride)
	if err != nil {
		return err
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
	conn := client.Conn()

	queryClient := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	report, err := queryClient.GetOrgUsageReport(context.Background(), &agentexecutionv1.GetOrgUsageReportInput{
		OrgId:    orgID,
		FromDate: fromDate,
		ToDate:   toDate,
	})
	if err != nil {
		return errors.Wrap(err, "failed to get organization usage report")
	}

	switch outputFormat {
	case "json":
		return writeReportJSON(report)
	case "yaml":
		return writeReportYAML(report)
	default:
		renderOrgUsageTable(report, fromDate, toDate)
		return nil
	}
}

func renderOrgUsageTable(report *agentexecutionv1.GetOrgUsageReportOutput, fromDate, toDate string) {
	fmt.Println()

	// Header
	fmt.Println("Organization Usage Report")
	fmt.Printf("Period: %s\n", formatInputDateRange(fromDate, toDate))
	fmt.Println()

	// Summary stats
	fmt.Printf("  Agents:       %d\n", report.GetTotalAgents())
	fmt.Printf("  Sessions:     %d\n", report.GetTotalSessions())
	fmt.Printf("  Executions:   %d\n", report.GetTotalExecutions())
	fmt.Printf("  Total cost:   %s\n", formatCost(report.GetTotalCostUsd()))
	fmt.Println()

	headerColor := color.New(color.FgCyan).SprintFunc()

	// Model breakdown table
	if len(report.GetModelBreakdown()) > 0 {
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

	// Top agents by cost
	if len(report.GetTopAgentsByCost()) > 0 {
		tbl := display.NewTable(
			[]string{"AGENT", "EXECUTIONS", "COST", "SHARE"},
			display.WithHeaderColor(headerColor),
			display.WithAdaptive(),
		)

		totalCost := report.GetTotalCostUsd()
		for _, a := range report.GetTopAgentsByCost() {
			name := a.GetAgentName()
			if name == "" {
				name = a.GetAgentId()
			}
			tbl.AddRow(
				name,
				fmt.Sprintf("%d", a.GetExecutionCount()),
				formatCost(a.GetEstimatedCostUsd()),
				formatShare(a.GetEstimatedCostUsd(), totalCost),
			)
		}

		tbl.Render(os.Stdout)
		fmt.Println()
	}

	// Daily cost trend
	if len(report.GetDailyCosts()) > 0 {
		tbl := display.NewTable(
			[]string{"DATE", "EXECUTIONS", "COST"},
			display.WithHeaderColor(headerColor),
			display.WithAdaptive(),
		)

		for _, day := range report.GetDailyCosts() {
			tbl.AddRow(
				day.GetDate(),
				fmt.Sprintf("%d", day.GetExecutionCount()),
				formatCost(day.GetEstimatedCostUsd()),
			)
		}

		tbl.Render(os.Stdout)
	}

	fmt.Println()
}
