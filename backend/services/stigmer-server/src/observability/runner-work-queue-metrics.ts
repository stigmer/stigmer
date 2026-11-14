/**
 * The count of calls sandboxed runners make on the server's Temporal worker
 * lane (transport/temporal-worker-door), `stigmer.runner.work_queue.calls`.
 *
 * The lane is a prefix lane on the unified port, ahead of the Connect
 * adapter, so the serving chain's `stigmer.grpc.request.count`
 * (rpc-metrics.ts) never sees these calls: this counter is their only
 * count. Its attributes say what happened and never whose it was:
 *
 *   - `method`: the bare WorkflowService method, or `unserved` for any the
 *     lane does not serve (the caller names it, so it is never a value);
 *   - `decision`: `allowed` (forwarded and answered), `refused` (the lane
 *     said no), `temporal_failed` (Temporal answered an error, relayed as
 *     is), `failed` (the lane could not do its part: no engine, no receipt
 *     key, a malformed frame) or `abandoned` (the caller left before its
 *     answer, with status `CANCELLED`, whatever the answer would have been);
 *   - `status`: the gRPC status NAME the caller received;
 *   - `check`: the rule that refused, or `none`.
 *
 * No session, organization or queue is an attribute: they are unbounded
 * and they would put one tenant's activity on every dashboard.
 *
 * rpc-metrics.ts's idiom: instruments created lazily on the global meter on
 * `@opentelemetry/api` alone, no-ops until a host registers a provider, and
 * the counter born at zero at boot.
 */
import type { Counter } from "@opentelemetry/api";

import type { GrpcStatusName } from "./rpc-metrics.js";

const METER_NAME = "stigmer-server";

export type WorkQueueDecision = "allowed" | "refused" | "temporal_failed" | "failed" | "abandoned";

export interface WorkQueueCall {
  readonly method: string;
  readonly decision: WorkQueueDecision;
  readonly status: GrpcStatusName;
  readonly check: string;
}

let counterPromise: Promise<Counter> | null = null;

function counter(): Promise<Counter> {
  counterPromise ??= import("@opentelemetry/api").then((api) =>
    api.metrics.getMeter(METER_NAME).createCounter("stigmer.runner.work_queue.calls", {
      description: "Calls sandboxed runners make on the Stigmer server's Temporal worker lane",
    }),
  );
  return counterPromise;
}

/** Fire-and-forget: the lane never awaits instrument resolution. */
export function recordWorkQueueCall(call: WorkQueueCall): void {
  void counter().then((instrument) => {
    instrument.add(1, {
      method: call.method,
      decision: call.decision,
      status: call.status,
      check: call.check,
    });
  });
}

/** Births the series at zero, attribute-less, before the port binds. */
export async function initWorkQueueMetrics(): Promise<void> {
  (await counter()).add(0);
}

/** Test seam: clears the memoized counter. */
export function resetWorkQueueMetrics(): void {
  counterPromise = null;
}
