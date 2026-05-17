# Application-Level OTel Spans + Baggage Propagation

**Date**: May 17, 2026

## Summary

Added application-level OpenTelemetry spans for LLM calls and eval judgments in the Go workflow-runner, and wired W3C baggage propagation (`execution_id`, `session_id`, `org_id`) across all three runners (Go, Python, TypeScript). Fixed propagator gaps in the Python agent-runner and TypeScript cursor-runner that prevented baggage from flowing through the distributed trace.

## Problem Statement

The Stigmer platform had OTel tracing infrastructure in place — Jaeger testcontainer, OTLP exporters, Temporal SDK tracing interceptors — but zero application-level spans. Temporal's auto-spans show activity boundaries (start/end) but provide no visibility into what happens inside activities: which LLM provider was called, what model was used, how many tokens were consumed, whether the call was proxied.

### Pain Points

- No way to trace individual LLM API calls (Anthropic, OpenAI) in Jaeger
- No token usage visibility at the span level — cost attribution requires log mining
- Eval judgments (LLM-as-a-judge) were opaque — no pass/fail/score in traces
- Python agent-runner's OTel `otel.py` claimed to configure W3C Baggage propagation but didn't — the code only set `TracerProvider`, silently breaking baggage flow
- TypeScript cursor-runner used only `W3CTraceContextPropagator`, missing `W3CBaggagePropagator`
- No W3C baggage items were set anywhere — the propagation infrastructure existed but carried zero domain context
- Integration tests wired Jaeger and OTel but never used `StartTestTrace` / `RegisterCleanup` — trace bundles were never exported

## Solution

Designed a span schema (`stigmer.llm.call`, `stigmer.llm.eval`, reserved `stigmer.mcp.tool_call`), instrumented the Go workflow-runner's LLM and eval activities, fixed propagator configuration in Python and TypeScript runners, and wired baggage at each runner's activity entry point.

## Implementation Details

**Span schema** (`pkg/otel/spans.go`): Centralized constants for span names, attribute keys, and baggage keys. Uses `attribute.Key` typed keys for compile-time safety. Shared naming convention across all runners: dot-separated, lowercase, `stigmer.*` namespace.

**Go workflow-runner spans**: `CallLlmActivity` wrapped with `stigmer.llm.call` span carrying 8 pre-call attributes (provider, model, proxy_active, max_tokens, temperature, has_response_schema, execution_id) and 2 post-call attributes (input_tokens, output_tokens). `EvalActivity` wrapped with `stigmer.llm.eval` span carrying eval-specific attributes (mode, model, threshold, passed, score). Child span relationship is automatic — the eval's inner LLM call creates a child span via context propagation.

**Baggage propagation**: `SetBaggage()` helper in Go wraps the verbose `baggage.NewMember` / `baggage.New` / `ContextWithBaggage` API. Python `set_baggage()` uses `opentelemetry.baggage.set_baggage` with `context.attach`. TypeScript `setBaggage()` uses `@opentelemetry/api` `propagation.setBaggage`. All three runners set `execution_id`, `session_id`, `org_id` after hydrating the execution from the database.

**Propagator fixes**: Python `otel.py` now calls `propagate.set_global_textmap(CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()]))`. TypeScript `otel.ts` replaced `W3CTraceContextPropagator` with `CompositePropagator` containing both propagators.

**Test harness**: Wired `StartTestTrace` + `RegisterCleanup` in `TestWorkflowLifecycle_SetTask_Completes` and `TestWorkflowLlmCall_StructuredOutput`. Added `AssertSpanExists` and `AssertSpanWithAttribute` Jaeger query helpers in `trace_assertions.go`.

## Benefits

- LLM calls are now visible as discrete spans in Jaeger with provider, model, and token usage attributes
- Eval judgments show pass/fail/score in the trace — debugging eval failures no longer requires log correlation
- Baggage propagation carries `execution_id`, `session_id`, `org_id` through every downstream service call automatically
- Python and TypeScript runners can now participate in baggage-based correlation without per-call header injection
- Integration tests export trace bundles on failure, enabling post-mortem trace analysis

## Impact

- **Workflow-runner**: Every `llm_call` and `eval` task now produces application-level spans
- **Agent-runner + cursor-runner**: Propagator fixes enable future span instrumentation (MCP tools, LangChain callbacks)
- **Integration tests**: Trace context flows from test binary → Java service → workflow-runner, with export on failure
- **Zero overhead when disabled**: All instrumentation is guarded by `OTEL_EXPORTER_OTLP_ENDPOINT`

## Files Changed (12)

**New (2):** `pkg/otel/spans.go`, `test/integration/harness/trace_assertions.go`
**Modified (10):** `pkg/otel/otel.go`, `task_builder_call_llm_activities.go`, `task_builder_eval_activities.go`, `otel.py`, `execute_graphton.py`, `otel.ts`, `execute-cursor.ts`, `harness.go`, `workflow_lifecycle_test.go`, `workflow_llm_call_test.go`

## Related Work

- Continues the OTel foundation from session 28-29 (Temporal SDK interceptors, Jaeger testcontainer, runner `InitTracing` modules)
- Enables the future "Application-level OTel spans for Python/TS" follow-up (MCP tool spans in graphton, LangChain callback instrumentation)
- Enables the future "OTel metrics" follow-up (histograms and counters at the same call sites)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours implementation
