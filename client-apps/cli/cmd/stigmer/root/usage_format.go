package root

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"gopkg.in/yaml.v3"
)

// fetchExecutionUsage calls the GetExecutionUsageReport RPC and returns the
// aggregate. Returns nil on any error — usage display is best-effort
// enrichment, not critical path.
func fetchExecutionUsage(ctx context.Context, client *stigmer.Client, executionID string) *agentexecutionv1.UsageReportAggregate {
	if client == nil || executionID == "" {
		return nil
	}
	resp, err := client.AgentExecution.GetExecutionUsageReport(ctx, &agentexecutionv1.GetExecutionUsageReportInput{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil
	}
	return resp.GetAggregate()
}

// formatCost renders a micro-USD cost as a human-readable USD string.
//
// Formatting rules:
//   - Zero:        "$0.00"
//   - Sub-dollar:  "$0.074" (three decimal places to show sub-cent granularity)
//   - Dollar+:     "$1.23"  (two decimal places, standard currency)
//   - Hundred+:    "$123.45"
func formatCost(micros int64) string {
	usd := float64(micros) / 1_000_000.0
	if usd == 0 {
		return "$0.00"
	}
	if usd < 1.0 {
		return fmt.Sprintf("$%.3f", usd)
	}
	return fmt.Sprintf("$%.2f", usd)
}

// formatCacheHitRate computes the cache hit percentage and returns a display
// string like "82% cached". Returns "" when there is no meaningful cache data
// (nil usage, zero input tokens, or zero cache reads).
func formatCacheHitRate(usage *agentexecutionv1.UsageReportAggregate) string {
	if usage == nil || usage.InputTokens == 0 || usage.CacheReadInputTokens == 0 {
		return ""
	}
	rate := float64(usage.CacheReadInputTokens) / float64(usage.InputTokens) * 100
	return fmt.Sprintf("%.0f%% cached", rate)
}

// formatModelLabel builds a display label from the primary model and provider.
// Returns "claude-sonnet-4 (anthropic)" when both are set, or just the model
// name when provider is absent. Returns "" when model is empty.
func formatModelLabel(usage *agentexecutionv1.UsageReportAggregate) string {
	if usage == nil || usage.PrimaryModel == "" {
		return ""
	}
	if usage.PrimaryProvider == "" {
		return usage.PrimaryModel
	}
	return fmt.Sprintf("%s (%s)", usage.PrimaryModel, usage.PrimaryProvider)
}

// formatTokensCompact renders input and output tokens as a compact pair:
// "12.5K in, 1.8K out". Uses the existing formatTokenCount helper.
func formatTokensCompact(in, out int64) string {
	return fmt.Sprintf("%s in, %s out", formatTokenCount(in), formatTokenCount(out))
}

// formatCostLine builds the "Cost: $0.074 (82% cached)" line for the
// execution summary panel. Returns "" when there is no cost data to show.
func formatCostLine(usage *agentexecutionv1.UsageReportAggregate) string {
	if usage == nil || usage.BillableCostMicros == 0 {
		return ""
	}
	cost := formatCost(usage.BillableCostMicros)
	if cache := formatCacheHitRate(usage); cache != "" {
		return fmt.Sprintf("%s (%s)", cost, cache)
	}
	return cost
}

// formatDate extracts the date portion from an ISO 8601 / RFC 3339 timestamp.
// Returns the date formatted as "Jan 02" for compact display.
// Returns the raw string (truncated to 10 chars) if parsing fails.
func formatDate(isoTimestamp string) string {
	if isoTimestamp == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, isoTimestamp)
	if err != nil {
		if len(isoTimestamp) >= 10 {
			return isoTimestamp[:10]
		}
		return isoTimestamp
	}
	return t.Format("Jan 02")
}

// formatDateRange returns "Jan 02 to Jan 05" from two ISO 8601 timestamps.
// Handles missing endpoints gracefully.
func formatDateRange(from, to string) string {
	f := formatDate(from)
	t := formatDate(to)
	if f == "" && t == "" {
		return ""
	}
	if f == "" {
		return "to " + t
	}
	if t == "" {
		return "from " + f
	}
	return f + " to " + t
}

// formatShare computes and formats a percentage share: "97.6%".
// Returns "0.0%" when total is zero to avoid division by zero.
func formatShare(part, total int64) string {
	if total == 0 {
		return "0.0%"
	}
	return fmt.Sprintf("%.1f%%", float64(part)/float64(total)*100)
}

// writeReportJSON writes a value as indented JSON to stdout.
func writeReportJSON(v interface{}) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// writeReportYAML writes a value as YAML to stdout.
func writeReportYAML(v interface{}) error {
	enc := yaml.NewEncoder(os.Stdout)
	enc.SetIndent(2)
	return enc.Encode(v)
}
