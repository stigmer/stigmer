# OpenTelemetry Distributed Tracing for Agent-Runner and Cursor-Runner

**Date**: May 17, 2026

## Summary

Added OpenTelemetry distributed tracing to the Python agent-runner and TypeScript cursor-runner, completing the span tree from the test harness through the workflow-runner into the agent execution layer. Both runners follow the same env-var-driven opt-in pattern established in Session 28 for the workflow-runner: `OTEL_EXPORTER_OTLP_ENDPOINT` gates all tracing; when unset, zero overhead.

## Problem Statement

Session 28 instrumented the test harness, Java service, and Go workflow-runner with OTel, but the span tree stopped at the `ExecuteWorkflow` activity. The two runners that actually execute agent code — Python's `ExecuteGraphton` and TypeScript's `ExecuteCursor` — were invisible in distributed traces. This gap made it impossible to see the full request path from test invocation through to agent execution.

### Pain Points

- Traces ended at the workflow-runner boundary — no visibility into whether the agent-runner or cursor-runner received the activity
- No way to correlate workflow-runner spans with agent execution spans in Jaeger
- Debugging cross-service latency required log correlation instead of a single trace view

## Solution

Instrumented both runners with OTel tracing using the same three-layer pattern:

1. **OTel SDK init module** — Env-var-driven `init_tracing()` / `initTracing()` that creates an OTLP/gRPC exporter and `TracerProvider`, returning a shutdown callable. No-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.
2. **Temporal SDK tracing interceptor** — First-party interceptors (`TracingInterceptor` for Python, `OpenTelemetryActivityInboundInterceptor` for TypeScript) that auto-create spans for activities and propagate W3C traceparent from the workflow-runner.
3. **Test harness wiring** — `OTLPEndpoint` field added to both runner configs, passed as `OTEL_EXPORTER_OTLP_ENDPOINT` to runner child processes when Jaeger is active.

## Implementation Details

### Python Agent-Runner

- New `worker/otel.py` — lazy-imports OTel packages inside `init_tracing()` to avoid loading them when tracing is disabled
- `__main__.py` — calls `init_tracing("agent-runner")` before worker start, `otel_shutdown()` in finally block
- `worker.py` — conditionally creates `TracingInterceptor` and passes it to `Client.connect(interceptors=...)`
- Dependencies: `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-grpc` (v1.41.1) added to `pyproject.toml` and `requirements.txt`

### TypeScript Cursor-Runner

- New `src/otel.ts` — async `initTracing()` using dynamic `import()` for ESM compatibility
- `src/main.ts` — calls `await initTracing("cursor-runner")` before fetch interceptor, shutdown after worker stops
- `src/worker.ts` — conditionally creates `OpenTelemetryActivityInboundInterceptor` via dynamic import
- Dependencies: `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-grpc`, `@temporalio/interceptors-opentelemetry` added to `package.json`

### Test Harness

- `agent_runner.go` / `cursor_runner.go` — `OTLPEndpoint` field, env var propagation
- `suite_test.go` — wires `testHarness.Jaeger.OTLPAddress` to both runner configs when OTel is enabled

## Benefits

- Full distributed trace from test harness through Java service, Temporal, workflow-runner, to agent/cursor execution
- Zero overhead when tracing is disabled — env-var gating, lazy imports, conditional interceptors
- Consistent pattern across all three languages (Go, Python, TypeScript)
- Temporal SDK interceptors handle W3C traceparent propagation automatically

## Impact

- **Integration tests**: `make test-traced` now produces complete traces spanning all services
- **Debugging**: Cross-service latency and failures visible in a single Jaeger trace view
- **Production readiness**: Same `OTEL_EXPORTER_OTLP_ENDPOINT` env var works in test, local dev, and production

## Related Work

- Session 28: OTel instrumentation for test harness and workflow-runner (T17)
- T17 original spec: Deferred runner instrumentation to this follow-up (option A chosen during planning)

---

**Status**: Production Ready
**Scope**: 12 files (2 new, 10 modified) across 3 languages
