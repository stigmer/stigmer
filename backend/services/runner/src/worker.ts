/**
 * Temporal worker setup for the unified runner service.
 *
 * The runner polls ACTIVITY tasks only, on its one queue, and registers no
 * workflow: every workflow is the server's, which schedules the runner's
 * activities on this queue (the connect listing's workflow moved to the
 * server in 2026-11). A worker that serves workflow tasks keeps state per
 * workflow on a sticky queue of its own, which a runner reaching Temporal
 * through the Stigmer server (temporal-lane.ts) cannot be given.
 */

import { NativeConnection, Worker, type ActivityInterceptorsFactory } from "@temporalio/worker";
import type { PayloadCodec } from "@temporalio/common";
import type { Config } from "./config.js";
import { telemetrySettings } from "./otel-export.js";
import { THROUGH_SERVER_ACTIVITY_POLLS, type TemporalLane } from "./temporal-lane.js";
import { runCredentialActivityInterceptor } from "./interceptors/run-credential-activity.js";
import { heartbeatWorkerOptions } from "./shared/heartbeat.js";

export interface WorkerActivities {
  [key: string]: (...args: any[]) => Promise<unknown>;
}

export interface StartWorkerOptions {
  config: Config;
  activities: WorkerActivities;
  /** Ordered codec chain from createPayloadCodecs (order is load-bearing). */
  payloadCodecs?: PayloadCodec[];
  /** How the worker reaches Temporal (temporal-lane.ts). */
  lane: TemporalLane;
}

/**
 * The worker and the connection it polls on. The caller owns both: it runs
 * and shuts down the worker, then closes the connection once `run()` has
 * resolved (the SDK refuses to close a connection a worker still holds).
 */
export interface StartedWorker {
  readonly worker: Worker;
  readonly connection: NativeConnection;
}

export async function startWorker(opts: StartWorkerOptions): Promise<StartedWorker> {
  const { config, activities, payloadCodecs, lane } = opts;

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
    ...lane.connection,
  });

  // The run credential (shared/run-credential.ts): the activity interceptor
  // enters the credential a dispatch carries for the client to present.
  // Always on; inert without a credential.
  const activityInterceptors: ActivityInterceptorsFactory[] = [runCredentialActivityInterceptor];

  const telemetry = telemetrySettings();
  if (telemetry.traces.enabled) {
    const { OpenTelemetryActivityInboundInterceptor } = await import(
      "@temporalio/interceptors-opentelemetry"
    );
    activityInterceptors.push(
      (ctx) => ({ inbound: new OpenTelemetryActivityInboundInterceptor(ctx) }),
    );
    console.log("Temporal OpenTelemetry activity interceptor enabled");
  }

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.taskQueue,
    activities,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivities,
    // Behind the server, a fixed few polls: the server bounds what one
    // sandbox may hold open (temporal-lane.ts). Stated as the poller
    // behaviour, the one option the SDK reads: 1.16.2 ignores
    // `maxConcurrentActivityTaskPolls` and opens up to ten (stigmer#2982).
    ...(lane.kind === "through-server"
      ? {
          activityTaskPollerBehavior: {
            type: "simple-maximum",
            maximum: THROUGH_SERVER_ACTIVITY_POLLS,
          },
        }
      : {}),
    // In-flight turns yield at a step boundary within it (`Config.drainGraceMs`).
    shutdownGraceTime: config.drainGraceMs,
    // A pause reaches a turn on its next heartbeat; sent within seconds.
    ...heartbeatWorkerOptions,
    dataConverter: payloadCodecs?.length ? { payloadCodecs } : undefined,
    interceptors: { activity: activityInterceptors },
  });

  return { worker, connection };
}
