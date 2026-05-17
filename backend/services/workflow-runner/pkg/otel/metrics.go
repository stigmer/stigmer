package otel

import (
	"sync"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Metric instrument names — shared across all Stigmer runners.
// Python and TypeScript runners mirror these names exactly.
const (
	MetricLlmCallDuration     = "stigmer.llm.call.duration"
	MetricLlmCallCount        = "stigmer.llm.call.count"
	MetricLlmTokensInput      = "stigmer.llm.tokens.input"
	MetricLlmTokensOutput     = "stigmer.llm.tokens.output"
	MetricActivityDuration    = "stigmer.activity.duration"
	MetricMcpToolCallDuration = "stigmer.mcp.tool_call.duration"
	MetricMcpToolCallCount    = "stigmer.mcp.tool_call.count"
	MetricExecutionCount      = "stigmer.execution.count"
	MetricExecutionActive     = "stigmer.execution.active"
)

// Instruments holds pre-registered OTel metric instruments. All instruments
// are created lazily on first use via GetInstruments(). When no MeterProvider
// is configured, the instruments are no-ops (global meter fallback).
type Instruments struct {
	LlmCallDuration     otelmetric.Float64Histogram
	LlmCallCount        otelmetric.Int64Counter
	LlmTokensInput      otelmetric.Int64Counter
	LlmTokensOutput     otelmetric.Int64Counter
	ActivityDuration    otelmetric.Float64Histogram
	McpToolCallDuration otelmetric.Float64Histogram
	McpToolCallCount    otelmetric.Int64Counter
	ExecutionCount      otelmetric.Int64Counter
	ExecutionActive     otelmetric.Int64UpDownCounter
}

var (
	instruments     *Instruments
	instrumentsOnce sync.Once
)

// GetInstruments returns the singleton set of metric instruments. Thread-safe.
func GetInstruments() *Instruments {
	instrumentsOnce.Do(func() {
		m := Meter()
		instruments = &Instruments{}

		instruments.LlmCallDuration, _ = m.Float64Histogram(
			MetricLlmCallDuration,
			otelmetric.WithDescription("Duration of LLM API calls in milliseconds"),
			otelmetric.WithUnit("ms"),
		)

		instruments.LlmCallCount, _ = m.Int64Counter(
			MetricLlmCallCount,
			otelmetric.WithDescription("Total number of LLM API calls"),
		)

		instruments.LlmTokensInput, _ = m.Int64Counter(
			MetricLlmTokensInput,
			otelmetric.WithDescription("Total input tokens consumed across LLM calls"),
			otelmetric.WithUnit("{token}"),
		)

		instruments.LlmTokensOutput, _ = m.Int64Counter(
			MetricLlmTokensOutput,
			otelmetric.WithDescription("Total output tokens produced across LLM calls"),
			otelmetric.WithUnit("{token}"),
		)

		instruments.ActivityDuration, _ = m.Float64Histogram(
			MetricActivityDuration,
			otelmetric.WithDescription("Duration of Temporal activities in milliseconds"),
			otelmetric.WithUnit("ms"),
		)

		instruments.McpToolCallDuration, _ = m.Float64Histogram(
			MetricMcpToolCallDuration,
			otelmetric.WithDescription("Duration of MCP tool calls in milliseconds"),
			otelmetric.WithUnit("ms"),
		)

		instruments.McpToolCallCount, _ = m.Int64Counter(
			MetricMcpToolCallCount,
			otelmetric.WithDescription("Total number of MCP tool calls"),
		)

		instruments.ExecutionCount, _ = m.Int64Counter(
			MetricExecutionCount,
			otelmetric.WithDescription("Total number of workflow/agent executions started"),
		)

		instruments.ExecutionActive, _ = m.Int64UpDownCounter(
			MetricExecutionActive,
			otelmetric.WithDescription("Currently active executions"),
		)
	})
	return instruments
}
