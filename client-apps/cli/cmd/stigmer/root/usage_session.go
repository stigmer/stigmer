package root

import (
	"context"
	"fmt"
	"os"

	"github.com/fatih/color"
	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

func newUsageSessionCommand() *cobra.Command {
	var outputFormat string

	cmd := &cobra.Command{
		Use:   "session <session-id>",
		Short: "View usage report for a session",
		Long: `View token usage, cost, and model breakdown for all executions in a session.

Shows per-model cost breakdown, per-execution detail, cache effectiveness,
and summarization costs.`,
		Example: `  # View session usage
  stigmer usage session ses_abc123

  # Output as JSON for scripting
  stigmer usage session ses_abc123 --output json`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			err := executeUsageSession(args[0], outputFormat)
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "output format: table, json, yaml")

	return cmd
}

func executeUsageSession(sessionID, outputFormat string) error {
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

	report, err := client.AgentExecution.GetSessionUsageReport(context.Background(), &agentexecutionv1.GetSessionUsageReportInput{
		SessionId: sessionID,
	})
	if err != nil {
		return errors.Wrap(err, "failed to get session usage report")
	}

	switch outputFormat {
	case "json":
		return writeReportJSON(report)
	case "yaml":
		return writeReportYAML(report)
	default:
		renderSessionUsageTable(report)
		return nil
	}
}

func renderSessionUsageTable(report *agentexecutionv1.GetSessionUsageReportOutput) {
	fmt.Println()

	// Header
	fmt.Printf("Session: %s\n", report.GetSessionId())
	period := formatDateRange(report.GetFirstExecutionAt(), report.GetLastExecutionAt())
	if period != "" {
		fmt.Printf("Period:  %s (%d executions)\n", period, report.GetExecutionCount())
	} else {
		fmt.Printf("Executions: %d\n", report.GetExecutionCount())
	}
	fmt.Println()

	// Model breakdown table
	if len(report.GetModelBreakdown()) > 0 {
		headerColor := color.New(color.FgCyan).SprintFunc()
		tbl := display.NewTable(
			[]string{"MODEL", "INPUT", "OUTPUT", "CACHED", "COST"},
			display.WithHeaderColor(headerColor),
			display.WithAdaptive(),
		)

		var totalInput, totalOutput, totalCached int32
		var totalCost float64

		for _, m := range report.GetModelBreakdown() {
			tbl.AddRow(
				m.GetModel(),
				formatTokenCount(m.GetInputTokens()),
				formatTokenCount(m.GetOutputTokens()),
				formatTokenCount(m.GetCacheReadTokens()),
				formatCost(m.GetEstimatedCostUsd()),
			)
			totalInput += m.GetInputTokens()
			totalOutput += m.GetOutputTokens()
			totalCached += m.GetCacheReadTokens()
			totalCost += m.GetEstimatedCostUsd()
		}

		if len(report.GetModelBreakdown()) > 1 {
			tbl.AddRow(
				"Total",
				formatTokenCount(totalInput),
				formatTokenCount(totalOutput),
				formatTokenCount(totalCached),
				formatCost(totalCost),
			)
		}

		tbl.Render(os.Stdout)
		fmt.Println()
	}

	// Cache and summarization stats
	if usage := report.GetTotalUsage(); usage != nil {
		if rate := formatCacheHitRate(usage); rate != "" {
			fmt.Printf("Cache hit rate: %s\n", rate)
		}
	}
	if report.GetTotalSummarizationCostUsd() > 0 {
		fmt.Printf("Summarization: %s\n", formatCost(report.GetTotalSummarizationCostUsd()))
	}

	// Execution breakdown table
	if len(report.GetExecutions()) > 0 {
		fmt.Println()

		headerColor := color.New(color.FgCyan).SprintFunc()
		tbl := display.NewTable(
			[]string{"#", "DATE", "TOKENS", "COST", "MODEL", "STATUS"},
			display.WithHeaderColor(headerColor),
			display.WithAdaptive(),
		)

		for i, exec := range report.GetExecutions() {
			tbl.AddRow(
				fmt.Sprintf("%d", i+1),
				formatDate(exec.GetStartedAt()),
				formatTokenCount(exec.GetPromptTokens()+exec.GetCompletionTokens()),
				formatCost(exec.GetEstimatedCostUsd()),
				exec.GetPrimaryModel(),
				mapPhaseToString(exec.GetPhase()),
			)
		}

		tbl.Render(os.Stdout)
	}

	fmt.Println()
}
