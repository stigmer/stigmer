# OTel A2 Application Spans + B Metrics — All Three Runners

**Date**: May 17, 2026

## Summary

Completed the remaining OTel observability work for Stigmer's runner fleet: application-level spans in the Python agent-runner and TypeScript cursor-runner (A2), and runtime metrics with centralized instrument definitions across all three runners — Go, Python, and TypeScript (B). This closes out the entire OTel initiative that began in Session 28.

## Problem Statement

After Session 30, the Go workflow-runner had fine-grained `stigmer.llm.call` and `stigmer.llm.eval` spans, but the Python agent-runner and TypeScript cursor-runner had only Temporal-level activity spans — no visibility into individual LLM calls, MCP tool invocations, or token usage within those activities. Additionally, no runtime metrics existed in any runner — no call counts, duration histograms, or token counters for dashboards and alerting.

### Pain Points

- No LLM call visibility in the Python runner (the primary execution path for agent workloads)
- No MCP tool call spans anywhere — cannot trace tool invocation latency or failures
- Cursor SDK opacity made it unclear what level of instrumentation was possible
- Zero runtime metrics — no histograms, counters, or gauges for operational monitoring
- Metric instrument definitions not centralized — risk of naming drift across three languages

## Solution

### A2: Application Spans

**Python agent-runner**: Created `OTelCallbackHandler` implementing LangChain's `BaseCallbackHandler`, registered on the `ChatAnthropic`/`ChatOpenAI` model instance during `create_deep_agent()`. The handler creates `stigmer.llm.call` spans on `on_chat_model_start`/`on_llm_end` with provider, model, and token usage attributes. For MCP tools, `on_tool_start`/`on_tool_end` creates `stigmer.mcp.tool_call` spans filtered by a tool-to-server reverse lookup — platform tools (read, write, execute) are excluded.

**TypeScript cursor-runner**: Created `stigmer.cursor.turn` span wrapping the `agent.send()` + `run.stream()` lifecycle. This is a coarse-grained span reflecting the Cursor SDK's opacity — we cannot instrument individual LLM calls or MCP tool invocations within the SDK. Token usage is set from the `UsageAccumulator` snapshot after streaming completes.

### B: OTel Metrics

Extended the OTel init in all three runners to create a `MeterProvider` alongside the existing `TracerProvider`, using the same env-var-driven pattern (OTLP/gRPC exporter, 30-second periodic reader, no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset).

Defined 9 metric instruments in a centralized Go file (`pkg/otel/metrics.go`) mirrored in Python and TypeScript:
- **Histograms**: LLM call duration, Temporal activity duration, MCP tool call duration
- **Counters**: LLM call count, input tokens, output tokens, MCP tool count, execution count
- **UpDownCounter**: Active executions

## Implementation Details

### Python OTel Callback (`otel_callback.py`)
- Uses `opentelemetry-api` (lightweight, no-op when SDK absent) as a graphton dependency
- Metric instruments created in `__init__` via `otel_metrics.get_meter("graphton")`
- Duration recorded via `time.monotonic()` delta between start/end callbacks
- Thread-safe: spans keyed by LangChain's unique `run_id` UUID

### TypeScript Turn Span (`otel.ts`, `execute-cursor.ts`)
- `startCursorTurnSpan()` helper returns a handle with `setTokens()` and `end()`
- `recordTurnMetrics()` helper records duration, call count, and token counters
- Both use dynamic `import("@opentelemetry/api")` for lazy loading

### Go Metric Wiring (`task_builder_call_llm_activities.go`)
- `time.Since(callStart)` for duration histogram
- Token counters from the existing `result["input_tokens"]`/`result["output_tokens"]` map
- Metric attributes limited to `provider` and `model` (low cardinality)

### Test Infrastructure
- `harness/metric_assertions.go`: `MetricReader` (ManualReader wrapper), `AssertCounterPositive`, `AssertHistogramRecorded`, `AssertMetricWithAttribute`
- Integration tests: `StartTestTrace` + `AssertSpanExists` wired into `workflow_agent_call_test.go` and `workflow_cursor_call_test.go`
- Unit tests: 10 tests in `test_otel_callback.py` covering LLM spans, MCP tool spans, error handling, concurrent runs, no-op behavior

## Benefits

- Full distributed trace visibility: test → Java service → Temporal → workflow-runner → agent-runner/cursor-runner → individual LLM calls and MCP tool invocations
- Operational metrics for dashboarding: LLM call duration percentiles, token consumption rates, MCP tool call counts
- Uniform span schema across all three runners — same attribute names, same semantic conventions
- Zero overhead when tracing/metrics are disabled — all instrumentation is env-var-gated

## Impact

- **Operators**: Can now build Grafana dashboards showing LLM call latency by model, token consumption trends, and MCP tool failure rates
- **Developers**: Distributed traces in Jaeger show the full call chain including individual LLM calls within agent executions
- **Test infra**: Integration tests can now assert on the presence of specific spans and metric values

## Related Work

- Session 28-29: OTel tracing init + Temporal interceptors across all runners
- Session 30: Go application spans (`stigmer.llm.call`, `stigmer.llm.eval`) + W3C baggage propagation
- This session: Python/TS application spans + metrics (completes the OTel initiative)

---

**Status**: Production Ready
**Timeline**: ~3 hours (single session)
