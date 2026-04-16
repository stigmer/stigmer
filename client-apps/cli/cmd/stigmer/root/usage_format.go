package root

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"gopkg.in/yaml.v3"
)

// computeExecutionUsage derives a UsageMetrics proto from per-message
// llm_metrics across main agent and all sub-agent messages.
// Returns nil when no LLM call metrics are present.
func computeExecutionUsage(exec *agentexecutionv1.AgentExecution) *agentexecutionv1.UsageMetrics {
	if exec == nil || exec.Status == nil {
		return nil
	}
	var (
		promptTokens     int32
		completionTokens int32
		cacheCreation    int32
		cacheRead        int32
		llmCallCount     int32
		estimatedCost    float64
		llmDurationMs    int32
		primaryModel     string
		primaryProvider  string
	)

	processMsg := func(msg *agentexecutionv1.AgentMessage) {
		m := msg.GetLlmMetrics()
		if m == nil {
			return
		}
		totalInput := m.InputTokens + m.CacheCreationTokens + m.CacheReadTokens
		promptTokens += totalInput
		completionTokens += m.OutputTokens
		cacheCreation += m.CacheCreationTokens
		cacheRead += m.CacheReadTokens
		llmCallCount++
		estimatedCost += m.EstimatedCostUsd
		llmDurationMs += m.DurationMs
		if primaryModel == "" && m.Model != "" {
			primaryModel = m.Model
			primaryProvider = m.Provider
		}
	}

	for _, msg := range exec.Status.Messages {
		processMsg(msg)
	}
	for _, sub := range exec.Status.SubAgentExecutions {
		for _, msg := range sub.Messages {
			processMsg(msg)
		}
	}

	if llmCallCount == 0 {
		return nil
	}

	return &agentexecutionv1.UsageMetrics{
		PromptTokens:        promptTokens,
		CompletionTokens:    completionTokens,
		TotalTokens:         promptTokens + completionTokens,
		LlmCallCount:        llmCallCount,
		CacheCreationTokens: cacheCreation,
		CacheReadTokens:     cacheRead,
		EstimatedCostUsd:    estimatedCost,
		LlmDurationMs:       llmDurationMs,
		PrimaryModel:        primaryModel,
		PrimaryProvider:     primaryProvider,
	}
}

// formatCost renders a USD cost as a human-readable string.
//
// Formatting rules:
//   - Zero:        "$0.00"
//   - Sub-dollar:  "$0.074" (three decimal places to show sub-cent granularity)
//   - Dollar+:     "$1.23"  (two decimal places, standard currency)
//   - Hundred+:    "$123.45"
func formatCost(usd float64) string {
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
// (nil usage, zero prompt tokens, or zero cache reads).
func formatCacheHitRate(usage *agentexecutionv1.UsageMetrics) string {
	if usage == nil || usage.PromptTokens == 0 || usage.CacheReadTokens == 0 {
		return ""
	}
	rate := float64(usage.CacheReadTokens) / float64(usage.PromptTokens) * 100
	return fmt.Sprintf("%.0f%% cached", rate)
}

// formatModelLabel builds a display label from the primary model and provider.
// Returns "claude-sonnet-4 (anthropic)" when both are set, or just the model
// name when provider is absent. Returns "" when model is empty.
func formatModelLabel(usage *agentexecutionv1.UsageMetrics) string {
	if usage == nil || usage.PrimaryModel == "" {
		return ""
	}
	if usage.PrimaryProvider == "" {
		return usage.PrimaryModel
	}
	return fmt.Sprintf("%s (%s)", usage.PrimaryModel, usage.PrimaryProvider)
}

// formatDurationBreakdown renders a compact summary of where execution time
// was spent: "LLM 12.3s · Tools 28.1s". Omits components that are zero.
// Returns "" when no duration data is available.
func formatDurationBreakdown(usage *agentexecutionv1.UsageMetrics) string {
	if usage == nil {
		return ""
	}

	var parts []string

	if usage.LlmDurationMs > 0 {
		parts = append(parts, fmt.Sprintf("LLM %s", formatMillis(usage.LlmDurationMs)))
	}
	if usage.ToolDurationMs > 0 {
		parts = append(parts, fmt.Sprintf("Tools %s", formatMillis(usage.ToolDurationMs)))
	}
	if usage.ApprovalWaitDurationMs > 0 {
		parts = append(parts, fmt.Sprintf("Approval %s", formatMillis(usage.ApprovalWaitDurationMs)))
	}

	return strings.Join(parts, " · ")
}

// formatMillis converts milliseconds to a human-readable duration string.
// Uses the same rounding as parseDuration (to the nearest second) for
// consistency with the existing duration display.
func formatMillis(ms int32) string {
	d := time.Duration(ms) * time.Millisecond
	return d.Round(time.Second).String()
}

// formatTokensCompact renders input and output tokens as a compact pair:
// "12.5K in, 1.8K out". Uses the existing formatTokenCount helper.
func formatTokensCompact(in, out int32) string {
	return fmt.Sprintf("%s in, %s out", formatTokenCount(in), formatTokenCount(out))
}

// formatCostLine builds the "Cost: $0.074 (82% cached)" line for the
// execution summary panel. Returns "" when there is no cost data to show.
func formatCostLine(usage *agentexecutionv1.UsageMetrics) string {
	if usage == nil || usage.EstimatedCostUsd == 0 {
		return ""
	}
	cost := formatCost(usage.EstimatedCostUsd)
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
func formatShare(part, total float64) string {
	if total == 0 {
		return "0.0%"
	}
	return fmt.Sprintf("%.1f%%", part/total*100)
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
