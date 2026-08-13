// Backend-hop readiness probe (stigmer/stigmer#316).
//
// /health reports process liveness only, which left a total backend-hop
// failure invisible: the bridge once spoke gRPC-web to a backend that only
// accepts native gRPC, every tool call failed for weeks, and all three
// Kubernetes probes stayed green. Readiness must therefore exercise the
// actual hop — transport, content-type, listener — with one cheap RPC.
//
// The probe RPC is grpc.health.v1.Health/Check: the one backend call both
// editions serve credential-free by design (the Go server sets it SERVING
// before its network listener opens; the cloud Java interceptors exempt
// "grpc.health.v1.Health" by name — "probes and tooling carry no bearer").
// The hosted bridge holds no startup credential (per-request Bearer
// passthrough only), so an authenticated probe is not an option.
//
// Only the READINESS probe should point here. Liveness and startup must stay
// on /health: readiness failure drains traffic (correct for a backend
// outage), while liveness/startup failures restart the pod — a restart loop
// that cannot fix a broken backend and destroys every live MCP session.

import { createClient } from "@connectrpc/connect";
import { Health, HealthCheckResponse_ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";
import { transportForToken } from "./domains/client.js";

/**
 * Per-check RPC bound. Deliberately below the probe's HTTP timeout in the
 * deployment overlay (5 s) so a hung backend yields a clean 503 with a
 * reason, never a probe-level timeout that hides it.
 */
export const READINESS_RPC_TIMEOUT_MS = 4_000;

/**
 * How long a verdict is served without re-dialing the backend. Bounds probe
 * (and operator curl) traffic to at most one backend RPC per window without
 * meaningfully delaying either transition: at the overlay's 10 s readiness
 * period, every scheduled probe still lands on a fresh check.
 */
export const READINESS_CACHE_TTL_MS = 5_000;

export interface ReadinessResult {
  ready: boolean;
  /** Human-readable cause when not ready; surfaced in the 503 body. */
  reason?: string;
}

/** Checks the backend hop once; see {@link createReadinessCheck} for caching. */
export async function checkBackendHealth(serverAddress: string): Promise<ReadinessResult> {
  const client = createClient(Health, transportForToken(serverAddress, ""));
  try {
    const res = await client.check({}, { timeoutMs: READINESS_RPC_TIMEOUT_MS });
    if (res.status === HealthCheckResponse_ServingStatus.SERVING) {
      return { ready: true };
    }
    return {
      ready: false,
      reason: `backend health status: ${HealthCheckResponse_ServingStatus[res.status] ?? res.status}`,
    };
  } catch (err) {
    return {
      ready: false,
      reason: `backend health check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build the cached readiness check used by the /ready route: verdicts are
 * reused for {@link READINESS_CACHE_TTL_MS} and concurrent callers share one
 * in-flight RPC, so probe pressure can never amplify into backend pressure.
 */
export function createReadinessCheck(
  serverAddress: string,
  check: (addr: string) => Promise<ReadinessResult> = checkBackendHealth,
): () => Promise<ReadinessResult> {
  let cached: { result: ReadinessResult; at: number } | undefined;
  let inFlight: Promise<ReadinessResult> | undefined;

  return async () => {
    if (cached !== undefined && Date.now() - cached.at < READINESS_CACHE_TTL_MS) {
      return cached.result;
    }
    if (inFlight === undefined) {
      inFlight = check(serverAddress)
        .then((result) => {
          cached = { result, at: Date.now() };
          return result;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };
}
