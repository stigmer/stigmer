/**
 * Temporal worker setup for the unified runner service.
 *
 * Single Worker, single queue — registers all activities (ExecuteCursor,
 * ExecuteDeepAgent, and future activities from Phase 4). The polyglot
 * :cursor queue suffix is eliminated; Temporal routes by activity name
 * within the queue.
 *
 * Architecture:
 * - Go/Java workflow orchestrates on "agent_execution_stigmer" queue
 * - This TypeScript worker polls the runner's base queue (runner:{id})
 * - Workflow dispatches activities by NAME to this queue
 * - Harness enum determines which activity name is invoked
 */

import { NativeConnection, Worker, type ActivityInterceptorsFactory } from "@temporalio/worker";
import type { Config } from "./config.js";

export interface WorkerActivities {
  [key: string]: (...args: any[]) => Promise<unknown>;
}

export async function startWorker(
  config: Config,
  activities: WorkerActivities,
): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const activityInterceptors: ActivityInterceptorsFactory[] = [];
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
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
    interceptors: activityInterceptors.length > 0
      ? { activity: activityInterceptors }
      : undefined,
  });

  return worker;
}
