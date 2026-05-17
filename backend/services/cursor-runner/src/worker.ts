/**
 * Temporal worker setup for the cursor-runner service.
 *
 * Connects to Temporal, registers the ExecuteCursor activity, and polls a
 * DERIVED task queue: `{baseQueue}:cursor`.
 *
 * Polyglot Architecture:
 * - Go/Java workflow orchestrates on "agent_execution_stigmer" queue
 * - Python worker registers ExecuteGraphton on the runner's base queue
 * - This TypeScript worker registers ExecuteCursor on `{baseQueue}:cursor`
 * - The workflow dispatches ExecuteCursor with an explicit TaskQueue option
 *   targeting the `:cursor` suffix, ensuring deterministic routing
 *
 * Why a separate queue:
 * Temporal dispatches activity tasks to any worker polling a queue without
 * regard to which activities each worker has registered. Sharing one queue
 * between Python and TypeScript workers causes non-deterministic routing —
 * the wrong worker can receive and permanently fail the activity.
 */

import { NativeConnection, Worker, type ActivityInboundCallsInterceptorFactory } from "@temporalio/worker";
import { CURSOR_QUEUE_SUFFIX, type Config } from "./config.js";
import { createActivities } from "./activity/execute-cursor.js";

export async function startWorker(config: Config): Promise<Worker> {
  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const activities = createActivities(config);
  const cursorTaskQueue = config.taskQueue + CURSOR_QUEUE_SUFFIX;

  const activityInterceptors: ActivityInboundCallsInterceptorFactory[] = [];
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { OpenTelemetryActivityInboundInterceptor } = await import(
      "@temporalio/interceptors-opentelemetry"
    );
    activityInterceptors.push(
      (ctx) => new OpenTelemetryActivityInboundInterceptor(ctx),
    );
    console.log("Temporal OpenTelemetry activity interceptor enabled");
  }

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: cursorTaskQueue,
    activities,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivities,
    interceptors: activityInterceptors.length > 0
      ? { activity: activityInterceptors }
      : undefined,
  });

  return worker;
}
