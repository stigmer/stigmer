/**
 * The gRPC request metrics the serving chain records — Java's
 * `stigmer.grpc.request.count` and `stigmer.grpc.request.duration`
 * (`GrpcRequestMetricsInterceptor`, cloud `backend/libs/java/grpc/
 * grpc-request`), names and labels verbatim: `rpc.service` (the
 * fully-qualified service name), `rpc.method` (the bare method name) and
 * `rpc.grpc.status_code` (the gRPC status NAME — `OK`, `NOT_FOUND`,
 * `CANCELLED` with two Ls — never Connect's PascalCase enum key, which the
 * SigNoz rules would not match). Three consumers read the pair under the
 * dotted-to-underscored spelling: `telemetry-heartbeat-lost` (the absence
 * of the count series for ten minutes), `grpc-error-rate-spike` (the
 * share of `status_code != OK`) and `grpc-latency-regression-p95` (the
 * duration histogram's buckets), plus the `gRPC RED` dashboard grouped by
 * every label. Convergence entry 20260909.02.
 *
 * This module is library instrumentation, on `@opentelemetry/api` alone:
 * instruments are created lazily on first use against the GLOBAL meter
 * provider and are no-ops until a host registers one, so every call site
 * records unconditionally (the OSS runner's otel-metrics.ts shape; the
 * cloud composition's registries are its siblings). Lazy creation is what
 * makes the host's boot order irrelevant — the API has no proxy meter
 * provider, so an instrument created before registration would stay a
 * no-op forever. Two facts a host must know:
 *
 *   - The counter is BORN AT ZERO by `initRpcMetrics` (Java's constructor
 *     `add(0)`, the heartbeat's premise, cloud#255): an attribute-less
 *     series exists from the first post-boot export, so the absence rule's
 *     ten-minute window measures the export pipeline, not an RPC-free lull
 *     after a restart. The histogram is deliberately NOT pre-registered —
 *     a `record(0)` is a real sample that would pollute the percentiles,
 *     and no rule watches its absence.
 *   - A host that installs this package from its own `node_modules` runs a
 *     second copy of `@opentelemetry/api`. The two share one global only
 *     while this copy's minor version does not exceed the registering
 *     copy's (`isCompatible`, `internal/semver.ts`); a lockfile bump here
 *     ahead of the host's makes these instruments silently inert. The
 *     cloud composition pins the same `^1.9.0` and proves the sharing with
 *     a composed test on every pin.
 *
 * `metricsExportPosture` lets the boot say which of the two states it is
 * in, so "nothing exported" and "nothing instrumented" stay
 * distinguishable in the log (the guidelines' explicit-optional-
 * infrastructure rule).
 */
import { Code } from "@connectrpc/connect";
import type { Counter, Histogram } from "@opentelemetry/api";

const METER_NAME = "stigmer-server";

/** `rpc.grpc.status_code` values: the gRPC status names, Java's `Status.Code.name()`. */
export type GrpcStatusName =
  | "OK"
  | "CANCELLED"
  | "UNKNOWN"
  | "INVALID_ARGUMENT"
  | "DEADLINE_EXCEEDED"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PERMISSION_DENIED"
  | "RESOURCE_EXHAUSTED"
  | "FAILED_PRECONDITION"
  | "ABORTED"
  | "OUT_OF_RANGE"
  | "UNIMPLEMENTED"
  | "INTERNAL"
  | "UNAVAILABLE"
  | "DATA_LOSS"
  | "UNAUTHENTICATED";

export const GRPC_STATUS_OK: GrpcStatusName = "OK";

/**
 * Connect's error code → the gRPC status name. Connect's `Code` enum has no
 * OK member (success is the absence of an error), so the table covers the
 * sixteen error codes and `GRPC_STATUS_OK` names success. Byte-exact
 * against grpc-java's `Status.Code`; the one spelling trap is CANCELLED.
 */
export function grpcStatusName(code: Code): GrpcStatusName {
  switch (code) {
    case Code.Canceled:
      return "CANCELLED";
    case Code.Unknown:
      return "UNKNOWN";
    case Code.InvalidArgument:
      return "INVALID_ARGUMENT";
    case Code.DeadlineExceeded:
      return "DEADLINE_EXCEEDED";
    case Code.NotFound:
      return "NOT_FOUND";
    case Code.AlreadyExists:
      return "ALREADY_EXISTS";
    case Code.PermissionDenied:
      return "PERMISSION_DENIED";
    case Code.ResourceExhausted:
      return "RESOURCE_EXHAUSTED";
    case Code.FailedPrecondition:
      return "FAILED_PRECONDITION";
    case Code.Aborted:
      return "ABORTED";
    case Code.OutOfRange:
      return "OUT_OF_RANGE";
    case Code.Unimplemented:
      return "UNIMPLEMENTED";
    case Code.Internal:
      return "INTERNAL";
    case Code.Unavailable:
      return "UNAVAILABLE";
    case Code.DataLoss:
      return "DATA_LOSS";
    case Code.Unauthenticated:
      return "UNAUTHENTICATED";
    default: {
      const exhaustive: never = code;
      throw new Error(`unknown Connect code ${String(exhaustive)}`);
    }
  }
}

export interface RpcInstruments {
  /** stigmer.grpc.request.duration {rpc.service, rpc.method, rpc.grpc.status_code} — ms, fractional. */
  readonly requestDuration: Histogram;
  /** stigmer.grpc.request.count — same labels; the heartbeat and error-rate series. */
  readonly requestCount: Counter;
}

// The PROMISE is memoized (not the result) so concurrent first callers
// share one creation — two racing registries would double-create every
// instrument.
let instrumentsPromise: Promise<RpcInstruments> | null = null;

export function getRpcInstruments(): Promise<RpcInstruments> {
  instrumentsPromise ??= createInstruments();
  return instrumentsPromise;
}

async function createInstruments(): Promise<RpcInstruments> {
  const api = await import("@opentelemetry/api");
  const meter = api.metrics.getMeter(METER_NAME);
  return {
    requestDuration: meter.createHistogram("stigmer.grpc.request.duration", {
      unit: "ms",
      description: "Duration of gRPC server requests in milliseconds",
    }),
    requestCount: meter.createCounter("stigmer.grpc.request.count", {
      description: "Total number of gRPC server requests",
    }),
  };
}

/**
 * Fire-and-forget record of one finished RPC — sync so the interceptor
 * never awaits instrument resolution on the request path. Both
 * instruments take the same attribute set, Java's single `close` record.
 */
export function recordRpc(
  service: string,
  method: string,
  status: GrpcStatusName,
  durationMs: number,
): void {
  void getRpcInstruments().then((registry) => {
    const attributes = {
      "rpc.service": service,
      "rpc.method": method,
      "rpc.grpc.status_code": status,
    };
    registry.requestDuration.record(durationMs, attributes);
    registry.requestCount.add(1, attributes);
  });
}

/**
 * Births the count series at zero, attribute-less (Java's constructor
 * posture — no fake `rpc.*` labels on a point that counts nothing).
 * Awaited by the boot before the port binds so a boot-time provider
 * exports the series before any traffic.
 */
export async function initRpcMetrics(): Promise<void> {
  const registry = await getRpcInstruments();
  registry.requestCount.add(0);
}

/**
 * Whether a meter provider is registered for these instruments to record
 * into. `exporting` is the host's doing (the cloud composition's
 * bootstrap, or any `setGlobalMeterProvider` before the first record);
 * `inert` is the OSS default until an export bootstrap exists. Read
 * through the public API only: the no-op meter is a singleton the API
 * exposes, so identity against it is the supported check.
 */
export type MetricsExportPosture = "exporting" | "inert";

export async function metricsExportPosture(): Promise<MetricsExportPosture> {
  const api = await import("@opentelemetry/api");
  return api.metrics.getMeter(METER_NAME) === api.createNoopMeter()
    ? "inert"
    : "exporting";
}

/** Test seam: clears the memoized registry. */
export function resetRpcInstruments(): void {
  instrumentsPromise = null;
}
