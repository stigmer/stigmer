# OpenTelemetry Distributed Tracing for Integration Tests

**Date**: May 17, 2026

## Summary

Added opt-in OpenTelemetry distributed tracing to the integration test infrastructure and workflow-runner. When `INTEGRATION_TEST_OTEL=true`, a Jaeger all-in-one container collects spans from the Go test harness, Java service, and Go workflow-runner, producing unified trace bundles on test failure for cross-service debugging.

## Problem Statement

Integration test failures require correlating logs across 4+ services (Go test harness, Java stigmer-service, Go workflow-runner, Python agent-runner, TypeScript cursor-runner). Each service writes to its own log file with no shared correlation ID, making failure diagnosis a manual log-splicing exercise.

### Pain Points

- No shared trace context across the test pipeline
- Debugging a failed workflow execution requires opening 3-4 log files and mentally correlating timestamps
- The Java service already has full OTel tracing infrastructure but it was disabled during tests (`OBSERVABILITY_ENABLED=false`)
- The Go workflow-runner had zero observability — no spans for workflows, activities, or task execution

## Solution

Layered OTel instrumentation across three services with a shared Jaeger trace collector:

1. **Test harness** creates root spans (`stigmer.apply`, `stigmer.run`, `stigmer.wait`) and propagates W3C `traceparent` via gRPC interceptors
2. **Java service** receives traceparent, creates correlated server spans (existing infrastructure, just enabled)
3. **Workflow-runner** uses Temporal SDK's OTel interceptor for automatic workflow/activity/signal spans

All spans flow to a Jaeger all-in-one Testcontainer. On test failure, the harness queries Jaeger's API and writes the full trace tree to `.test-output/traces/{test-name}.json`.

## Implementation Details

### New Files (4)

- `test/integration/harness/jaeger.go` — Jaeger all-in-one Testcontainer lifecycle (OTLP/gRPC on 4317, Query API on 16686)
- `test/integration/harness/otel.go` — OTel SDK bootstrap (TracerProvider, OTLP exporter, gRPC stats handler)
- `test/integration/harness/trace_bundle.go` — Per-test `TraceContext` struct, Jaeger Query API export on `t.Failed()`
- `backend/services/workflow-runner/pkg/otel/otel.go` — Env-var-driven OTel init (`OTEL_EXPORTER_OTLP_ENDPOINT`), no-op when unset

### Modified Files (10)

- `harness.go` — Added `Jaeger *JaegerContainer`, parallel start, `OTelEnabled()`, `IsOTelRequested()`
- `fixture.go` — `stigmer.apply` and `stigmer.run` spans with workflow/execution attributes
- `assertions.go` — `stigmer.wait` span in `WaitForTerminal` with phase/task count
- `service.go` — Conditional `OBSERVABILITY_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` for Java
- `workflow_runner.go` — `OTLPEndpoint` config field, passed as `OTEL_EXPORTER_OTLP_ENDPOINT`
- `suite_test.go` — OTel init/shutdown lifecycle, gRPC interceptors, OTLP endpoint wiring
- `worker/worker.go` — Temporal `opentelemetry.NewTracingInterceptor` on `client.Dial`
- `cmd/worker/root.go` — `stgmotel.InitTracing` call at startup with graceful degradation
- `ci.integration-offline.yaml` — `INTEGRATION_TEST_OTEL=true` in CI, trace bundle artifact upload
- `Makefile` — `test-traced` convenience target

### Key Design Decisions

- **DD-T17-01: Opt-in tracing** — Gated on `INTEGRATION_TEST_OTEL=true`. Zero overhead when disabled. CI always enables.
- **DD-T17-02: Jaeger all-in-one** — Queryable API (unlike raw OTel Collector) enables programmatic trace export on failure.
- **DD-T17-03: Standard `OTEL_EXPORTER_OTLP_ENDPOINT`** — Same env var convention across all services and environments.
- **DD-T17-04: No-op when disabled** — Workflow-runner `InitTracing` returns nil when endpoint unset. Zero production overhead.

## Benefits

- Failed integration tests now produce a complete cross-service trace bundle automatically
- Developers can open Jaeger UI during local runs for visual trace debugging
- Zero stigmer-cloud code changes — Java service's existing `OpenTelemetryConfig` + `application-observability.yaml` handle everything via env vars
- Workflow-runner now has OTel infrastructure that works in production too (just set the endpoint)
- Temporal SDK interceptor provides automatic spans for workflows, activities, signals, and queries

## Impact

- **Integration test debugging**: Minutes instead of hours for cross-service failures
- **CI artifacts**: Failed test runs now include trace JSON bundles alongside JUnit XML
- **Workflow-runner production readiness**: OTel support ready for production use (SigNoz, Jaeger, any OTLP-compatible backend)
- **Test startup**: +3 seconds when enabled (Jaeger container), zero impact when disabled

## Related Work

- T15: Temporal Workflow Replay CI Gate (Session 25)
- T16: Flake Management Infrastructure (Session 26)
- T17 completes Phase 4 of the E2E Workflow Testing Infrastructure project

---

**Status**: Production Ready
**Timeline**: Session 28 (May 17, 2026)
