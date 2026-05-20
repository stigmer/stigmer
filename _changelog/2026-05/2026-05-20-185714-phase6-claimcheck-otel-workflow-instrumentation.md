# Phase 6: Claimcheck PayloadCodec + OTel Workflow Instrumentation

**Date**: May 20, 2026

## Summary

Added transparent large-payload offloading (PayloadCodec claimcheck) and full OpenTelemetry workflow instrumentation to the TypeScript unified runner. Activities now heartbeat for long-running operations, and W3C baggage propagates execution context to downstream services. All features are env-gated with zero overhead when disabled.

## Problem Statement

The TypeScript workflow runner (replacing the Go workflow-runner) lacked two critical production infrastructure pieces:

1. **No payload size protection** — Temporal's 2MB payload limit could be hit by large LLM responses, agent outputs, or accumulated workflow state, causing cryptic `PayloadTooLarge` failures.
2. **No workflow-level observability** — While activity OTel interceptors existed, there were no execution-level metrics, no workflow spans, no heartbeating for long-running activities, and no baggage propagation for distributed tracing.

### Pain Points

- Large `call:agent` or `call:llm` responses could silently exceed Temporal payload limits
- No way to distinguish a hung activity from a legitimately long-running one
- Workflow execution duration, count, and active gauge had no metrics
- Downstream HTTP/gRPC calls had no correlation to parent workflow execution
- Parent workflow cancellation did not propagate to in-flight activities

## Solution

Two independent, additive subsystems — both env-gated and zero-overhead when disabled:

1. **ClaimcheckPayloadCodec** — operates at the Temporal `DataConverter` layer below the workflow engine kernel. Payloads >= 128KB are gzip-compressed, uploaded to ArtifactStorage (local or proxy), and replaced with a small reference marker. On decode (replay), markers are detected and original payloads are retrieved transparently.

2. **OTel Workflow Instrumentation** — workflow-side spans via `@temporalio/interceptors-opentelemetry` (workflowModules + makeWorkflowExporter sink), a metrics sink for execution timing, activity heartbeating utility, and W3C baggage propagation through state.env.

## Implementation Details

### Claimcheck (`src/claimcheck/`)

- `payload-codec.ts` — implements Temporal `PayloadCodec` interface (encode/decode)
- `compressor.ts` — synchronous gzip via `zlib.gzipSync`/`gunzipSync`
- `config.ts` — env-driven: `CLAIMCHECK_ENABLED`, `CLAIMCHECK_THRESHOLD_BYTES`, `CLAIMCHECK_COMPRESSION_ENABLED`
- Storage: reuses existing `ArtifactStorage` interface (local filesystem or presigned-URL proxy)
- Marker format: `{ encoding: "binary/claimcheck" }` metadata + JSON body with key, size, compressed flag
- Wired via `dataConverter: { payloadCodecs: [codec] }` in `Worker.create()`

### OTel Metrics (`src/otel-metrics.ts`)

- Lazy singleton registry matching Go `pkg/otel/metrics.go` instrument names
- 5 instruments: `stigmer.execution.count`, `stigmer.execution.active`, `stigmer.activity.duration`, `stigmer.workflow.task.duration`, `stigmer.workflow.task.count`

### Workflow OTel Interceptors

- `@temporalio/interceptors-opentelemetry` `workflow-interceptors` module registered via `workflowModules` worker option
- `makeWorkflowExporter` creates a sink that exports workflow spans to OTLP
- Custom metrics sink (`workflows/metrics-sink.ts` + `interceptors/workflow-metrics-sink.ts`) bridges sandbox → worker OTel instruments

### Activity Heartbeating (`src/shared/heartbeat.ts`)

- `startHeartbeat(intervalMs, getDetails)` — periodic heartbeat with cancellation detection
- Applied to: `CallHttp` (10s), `CallAgent` (15s), `RunScript`/`RunShell` (10s)
- `heartbeatTimeout: "30s"` on activity proxy options

### Baggage Propagation

- `__stigmer_execution_id`, `__stigmer_org_id`, `__stigmer_workflow_id` injected into workflow `state.env`
- HTTP activities inject `baggage` W3C header on outgoing requests
- OTel constants updated to full Go parity (span names, attribute keys, baggage keys)

## Benefits

- **Payload safety**: Automatic protection against Temporal 2MB limit — no workflow code changes needed
- **Observability**: Complete trace trees for workflow executions, per-activity spans, execution metrics
- **Operational health**: Heartbeating enables Temporal to detect hung activities within 30s (vs full timeout)
- **Cancellation propagation**: Parent workflow cancellation now propagates to in-flight activities
- **Distributed tracing**: Downstream services can correlate requests to parent workflow execution
- **Zero overhead when disabled**: Both features check env vars and are no-ops otherwise

## Impact

- **Runner service** (`backend/services/runner/`): 10 files modified, 10 files created
- **Kernel untouched**: `src/workflow-engine/` has zero changes — architectural invariant preserved
- **Test suite**: 1386 tests passing, 19 new tests added (15 claimcheck + 4 metrics)
- **Dependencies**: +1 explicit (`@opentelemetry/sdk-metrics`)

## Related Work

- Phase 5 (Sessions 7-10): Complete workflow engine task implementation
- Go reference: `backend/services/workflow-runner/pkg/claimcheck/` and `pkg/otel/`
- Cloud proxy: `stigmer-cloud` Java `ClaimCheckProxyController` (presigned URLs)
- Remaining Phase 6: event emission delivery, budget tracking, notification registry

---

**Status**: Production Ready (env-gated)
**Timeline**: 1 session (~45 min)
